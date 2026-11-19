// Penerus permintaan ke provider AI. Berjalan di mesin pengguna sendiri (next dev/start di localhost),
// hanya ada supaya browser tidak terbentur CORS. Key datang per permintaan, tidak disimpan, tidak di-log.
import type { ProviderProfile } from "@/lib/data";

type Body = { profile: ProviderProfile; key?: string; op: "test" | "text" | "image"; system?: string; prompt?: string };
type Out = { ok: boolean; status?: number; text?: string; image?: string; error?: string };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const join = (base: string, path: string) => base.replace(/\/+$/, "") + path;

class HttpErr extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

async function call(url: string, init: RequestInit, timeoutSecs: number) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(Math.max(5, timeoutSecs) * 1000) });
  const raw = await res.text();
  let json: any = null;
  try { json = JSON.parse(raw); } catch {}
  if (!res.ok) {
    const e = json?.error;
    const msg = (typeof e === "string" ? e : e?.message) || json?.message || raw.slice(0, 240) || res.statusText;
    throw new HttpErr(res.status, msg);
  }
  return { status: res.status, json };
}

function openAiHeaders(p: ProviderProfile, key?: string) {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (key) h.authorization = `Bearer ${key}`;
  if (p.kind === "OpenRouter") h["x-title"] = "Storyboard Studio";
  return h;
}

async function text(p: ProviderProfile, key: string | undefined, system: string, prompt: string): Promise<string> {
  const t = p.timeout_secs;
  if (p.kind === "Anthropic") {
    const { json } = await call(join(p.base_url, "/v1/messages"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key ?? "", "anthropic-version": p.api_version || "2023-06-01" },
      body: JSON.stringify({ model: p.text_model, max_tokens: p.max_output_tokens, temperature: p.temperature, system, messages: [{ role: "user", content: prompt }] }),
    }, t);
    return (json?.content ?? []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("");
  }
  if (p.kind === "Gemini") {
    const { json } = await call(join(p.base_url, `/v1beta/models/${encodeURIComponent(p.text_model)}:generateContent`), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key ?? "" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: p.max_output_tokens, temperature: p.temperature },
      }),
    }, t);
    return (json?.candidates?.[0]?.content?.parts ?? []).map((x: any) => x.text ?? "").join("");
  }
  const send = (withTemp: boolean) => call(join(p.base_url, "/chat/completions"), {
    method: "POST",
    headers: openAiHeaders(p, key),
    body: JSON.stringify({
      model: p.text_model,
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      [p.kind === "OpenAi" ? "max_completion_tokens" : "max_tokens"]: p.max_output_tokens,
      ...(withTemp ? { temperature: p.temperature } : {}),
    }),
  }, t);
  try {
    return (await send(true)).json?.choices?.[0]?.message?.content ?? "";
  } catch (e) {
    // Beberapa model reasoning menolak parameter temperature; ulangi sekali tanpa itu.
    if (e instanceof HttpErr && e.status === 400 && /temperature/i.test(e.message)) return (await send(false)).json?.choices?.[0]?.message?.content ?? "";
    throw e;
  }
}

async function toDataUrl(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
  const buf = Buffer.from(await r.arrayBuffer());
  return `data:${r.headers.get("content-type") || "image/png"};base64,${buf.toString("base64")}`;
}

async function image(p: ProviderProfile, key: string | undefined, prompt: string): Promise<string> {
  const t = Math.max(p.timeout_secs, 120);
  if (!p.image_model) throw new HttpErr(400, "Model gambar belum diisi di profil ini.");
  if (p.kind === "Anthropic" || p.kind === "OllamaLocal") throw new HttpErr(400, "Provider ini tidak menyediakan pembuatan gambar.");
  if (p.kind === "Gemini") {
    const { json } = await call(join(p.base_url, `/v1beta/models/${encodeURIComponent(p.image_model)}:generateContent`), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key ?? "" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ["IMAGE", "TEXT"], imageConfig: { aspectRatio: "9:16" } },
      }),
    }, t);
    const part = (json?.candidates?.[0]?.content?.parts ?? []).find((x: any) => x.inlineData);
    if (!part) throw new HttpErr(502, "Respons tidak berisi gambar.");
    return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
  }
  if (p.kind === "OpenRouter") {
    const { json } = await call(join(p.base_url, "/chat/completions"), {
      method: "POST",
      headers: openAiHeaders(p, key),
      body: JSON.stringify({ model: p.image_model, messages: [{ role: "user", content: prompt }], modalities: ["image", "text"], image_config: { aspect_ratio: "9:16" } }),
    }, t);
    const url = json?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!url) throw new HttpErr(502, "Respons tidak berisi gambar.");
    return url.startsWith("data:") ? url : toDataUrl(url);
  }
  const size = p.kind === "OpenAi" ? { size: /dall-e-3/i.test(p.image_model) ? "1024x1792" : "1024x1536" } : {};
  const { json } = await call(join(p.base_url, "/images/generations"), {
    method: "POST",
    headers: openAiHeaders(p, key),
    body: JSON.stringify({ model: p.image_model, prompt, n: 1, ...size }),
  }, t);
  const d = json?.data?.[0];
  if (d?.b64_json) return `data:image/png;base64,${d.b64_json}`;
  if (d?.url) return toDataUrl(d.url);
  throw new HttpErr(502, "Respons tidak berisi gambar.");
}

async function test(p: ProviderProfile, key?: string): Promise<Out> {
  const [url, headers] =
    p.kind === "Anthropic" ? [join(p.base_url, "/v1/models"), { "x-api-key": key ?? "", "anthropic-version": p.api_version || "2023-06-01" }]
    : p.kind === "Gemini" ? [join(p.base_url, "/v1beta/models"), { "x-goog-api-key": key ?? "" }]
    : [join(p.base_url, "/models"), openAiHeaders(p, key)];
  const { status, json } = await call(url, { headers }, p.timeout_secs);
  const n = (json?.data ?? json?.models ?? []).length;
  return { ok: true, status, text: n ? `${n} model tersedia` : "Terhubung" };
}

export async function POST(req: Request) {
  let b: Body;
  try { b = await req.json(); } catch { return Response.json({ ok: false, error: "Permintaan tidak valid." } satisfies Out, { status: 400 }); }
  const p = b.profile;
  try {
    const u = new URL(p.base_url);
    if (u.protocol !== "https:" && !(u.protocol === "http:" && LOOPBACK.has(u.hostname))) {
      return Response.json({ ok: false, error: "HTTP tanpa TLS hanya diizinkan untuk localhost / 127.0.0.1." } satisfies Out);
    }
  } catch {
    return Response.json({ ok: false, error: "Base URL tidak valid." } satisfies Out);
  }
  try {
    if (b.op === "test") return Response.json(await test(p, b.key));
    if (!p.text_model && b.op === "text") return Response.json({ ok: false, error: "Model teks belum diisi di profil ini." } satisfies Out);
    if (b.op === "text") return Response.json({ ok: true, text: await text(p, b.key, b.system ?? "", b.prompt ?? "") } satisfies Out);
    return Response.json({ ok: true, image: await image(p, b.key, b.prompt ?? "") } satisfies Out);
  } catch (e) {
    if (e instanceof HttpErr) return Response.json({ ok: false, status: e.status, error: e.message } satisfies Out);
    const name = (e as Error)?.name;
    return Response.json({ ok: false, error: name === "TimeoutError" ? `Waktu habis setelah ${p.timeout_secs} detik.` : `Gagal terhubung: ${(e as Error)?.message}` } satisfies Out);
  }
}
