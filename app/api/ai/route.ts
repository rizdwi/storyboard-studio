// Penerus permintaan ke provider AI. Mendukung streaming SSE -> NDJSON agar token
// mengalir langsung ke antarmuka dan tidak terputus batas 60 detik. Key tidak disimpan atau di-log.
import type { ProviderProfile } from "@/lib/data";

export const maxDuration = 300;

type Body = { profile: ProviderProfile; key?: string; op: "test" | "text" | "stream" | "image"; system?: string; prompt?: string };
type Out = { ok: boolean; status?: number; text?: string; image?: string; error?: string };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
const join = (base: string, path: string) => base.replace(/\/+$/, "") + path;
// Profil lama di localStorage mungkin masih menyimpan 60 dtk; naikkan minimal 180 dtk untuk generasi.
const genTimeout = (p: ProviderProfile) => Math.max(p.timeout_secs || 180, 180);

class HttpErr extends Error {
  constructor(public status: number, msg: string) { super(msg); }
}

function parseErr(status: number, statusText: string, raw: string): HttpErr {
  let json: any = null;
  try { json = JSON.parse(raw); } catch {}
  const e = json?.error;
  const msg = (typeof e === "string" ? e : e?.message) || json?.message || raw.slice(0, 280) || statusText;
  return new HttpErr(status, msg);
}

async function call(url: string, init: RequestInit, timeoutSecs: number) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(Math.max(10, timeoutSecs) * 1000) });
  const raw = await res.text();
  if (!res.ok) throw parseErr(res.status, res.statusText, raw);
  let json: any = null;
  try { json = JSON.parse(raw); } catch {}
  return { status: res.status, json };
}

function openAiHeaders(p: ProviderProfile, key?: string) {
  const h: Record<string, string> = { "content-type": "application/json" };
  if (key) h.authorization = `Bearer ${key}`;
  if (p.kind === "OpenRouter") h["x-title"] = "Storyboard Studio";
  return h;
}

async function text(p: ProviderProfile, key: string | undefined, system: string, prompt: string): Promise<string> {
  const t = genTimeout(p);
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
        generationConfig: { maxOutputTokens: Math.max(p.max_output_tokens || 4096, 8192), temperature: p.temperature },
      }),
    }, t);
    return (json?.candidates?.[0]?.content?.parts ?? []).filter((x: any) => !x.thought).map((x: any) => x.text ?? "").join("");
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
    if (e instanceof HttpErr && e.status === 400 && /temperature/i.test(e.message)) return (await send(false)).json?.choices?.[0]?.message?.content ?? "";
    throw e;
  }
}

async function openUpstreamStream(p: ProviderProfile, key: string | undefined, system: string, prompt: string, signal: AbortSignal): Promise<Response> {
  if (p.kind === "Anthropic") {
    return fetch(join(p.base_url, "/v1/messages"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key ?? "", "anthropic-version": p.api_version || "2023-06-01" },
      body: JSON.stringify({ model: p.text_model, max_tokens: p.max_output_tokens, temperature: p.temperature, system, stream: true, messages: [{ role: "user", content: prompt }] }),
      signal,
    });
  }
  if (p.kind === "Gemini") {
    return fetch(join(p.base_url, `/v1beta/models/${encodeURIComponent(p.text_model)}:streamGenerateContent?alt=sse`), {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": key ?? "" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: Math.max(p.max_output_tokens || 4096, 8192), temperature: p.temperature },
      }),
      signal,
    });
  }
  const reqChat = (withTemp: boolean) => fetch(join(p.base_url, "/chat/completions"), {
    method: "POST",
    headers: openAiHeaders(p, key),
    body: JSON.stringify({
      model: p.text_model,
      stream: true,
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      [p.kind === "OpenAi" ? "max_completion_tokens" : "max_tokens"]: p.max_output_tokens,
      ...(withTemp ? { temperature: p.temperature } : {}),
    }),
    signal,
  });
  const res = await reqChat(true);
  if (!res.ok && res.status === 400) {
    const raw = await res.text();
    if (/temperature/i.test(raw)) return reqChat(false);
    throw parseErr(res.status, res.statusText, raw);
  }
  return res;
}

function streamText(p: ProviderProfile, key: string | undefined, system: string, prompt: string): Response {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const idleMs = genTimeout(p) * 1000;
  let ctrl = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => controller.enqueue(enc.encode(JSON.stringify(obj) + "\n"));
      let timer = setTimeout(() => ctrl.abort(new Error("IDLE_TIMEOUT")), idleMs);
      const touch = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(new Error("IDLE_TIMEOUT")), idleMs); };
      // Heartbeat setiap 12 dtk mencegah proxy/CDN memutus koneksi saat model reasoning diam lama.
      const hb = setInterval(() => { try { send({ t: "hb" }); } catch {} }, 12000);

      try {
        send({ t: "start" });
        const res = await openUpstreamStream(p, key, system, prompt, ctrl.signal);
        if (!res.ok) {
          const raw = await res.text();
          throw parseErr(res.status, res.statusText, raw);
        }
        const ctype = res.headers.get("content-type") || "";
        // Bila endpoint kustom mengabaikan stream:true dan membalas JSON penuh:
        if (!ctype.includes("event-stream") && res.body) {
          const raw = await res.text();
          let json: any = null;
          try { json = JSON.parse(raw); } catch {}
          const direct =
            json?.choices?.[0]?.message?.content ??
            (json?.content ?? []).map((x: any) => x.text ?? "").join("") ??
            (json?.candidates?.[0]?.content?.parts ?? []).filter((x: any) => !x.thought).map((x: any) => x.text ?? "").join("");
          if (direct) { send({ t: "d", c: direct }); send({ t: "done" }); return; }
        }
        if (!res.body) throw new Error("Respons stream kosong dari provider.");

        const reader = res.body.getReader();
        let buf = "";
        const handleLine = (line: string) => {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) return;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") return;
          let j: any = null;
          try { j = JSON.parse(payload); } catch { return; }
          if (j?.error) throw new HttpErr(j.error.code || 500, j.error.message || JSON.stringify(j.error));

          if (p.kind === "Anthropic") {
            if (j.type === "content_block_delta") {
              if (j.delta?.type === "text_delta" && j.delta.text) send({ t: "d", c: j.delta.text });
              else if (j.delta?.type === "thinking_delta") send({ t: "think" });
            } else if (j.type === "error") {
              throw new HttpErr(500, j.error?.message || "Anthropic stream error");
            }
          } else if (p.kind === "Gemini") {
            for (const part of j.candidates?.[0]?.content?.parts ?? []) {
              if (part.thought) send({ t: "think" });
              else if (part.text) send({ t: "d", c: part.text });
            }
          } else {
            const delta = j.choices?.[0]?.delta;
            if (typeof delta?.content === "string" && delta.content) send({ t: "d", c: delta.content });
            else if (delta?.reasoning_content || delta?.reasoning || delta?.thinking) send({ t: "think" });
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          touch();
          buf += dec.decode(value, { stream: true });
          const lines = buf.split(/\r?\n/);
          buf = lines.pop() ?? "";
          for (const l of lines) handleLine(l);
        }
        if (buf.trim()) handleLine(buf);
        send({ t: "done" });
      } catch (e) {
        if (e instanceof HttpErr) {
          send({ t: "err", status: e.status, error: e.message });
        } else {
          const msg = (e as Error)?.message || "";
          const timedOut = msg.includes("IDLE_TIMEOUT") || (e as Error)?.name === "TimeoutError" || (e as Error)?.name === "AbortError";
          send({
            t: "err",
            error: timedOut
              ? `Provider tidak mengirim data selama ${genTimeout(p)} detik. Periksa nama model atau naikkan Timeout di Pengaturan AI.`
              : `Gagal terhubung: ${msg}`,
          });
        }
      } finally {
        clearInterval(hb);
        clearTimeout(timer);
        controller.close();
      }
    },
    cancel() {
      ctrl.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

async function toDataUrl(url: string) {
  const r = await fetch(url, { signal: AbortSignal.timeout(90000) });
  const buf = Buffer.from(await r.arrayBuffer());
  return `data:${r.headers.get("content-type") || "image/png"};base64,${buf.toString("base64")}`;
}

async function image(p: ProviderProfile, key: string | undefined, prompt: string): Promise<string> {
  const t = genTimeout(p);
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
  const { status, json } = await call(url, { headers }, Math.max(p.timeout_secs || 30, 30));
  const n = (json?.data ?? json?.models ?? []).length;
  return { ok: true, status, text: n ? `${n} model tersedia` : "Terhubung" };
}

/** Key cadangan dari env server — dipakai hanya bila profil belum punya key sendiri (BYOK).
    Key tidak pernah ditulis ke repo; env diisi di .env.local / Vercel. */
const envKeyFor = (p: ProviderProfile, op: Body["op"]): string | undefined => {
  if (p.id === "default-hydrogen-9router") return process.env.NINE_ROUTER_API_KEY || undefined;
  if (p.kind === "Gemini") {
    return op === "image"
      ? process.env.GEMINI_IMAGE_API_KEY || process.env.GEMINI_API_KEY || undefined
      : process.env.GEMINI_API_KEY || undefined;
  }
  return undefined;
};

/** Status key server (tanpa nilai): dipakai GET /api/ai agar UI tahu profil bawaan sudah siap. */
export async function GET() {
  return Response.json({
    ok: true,
    serverKeys: {
      hydrogen: !!process.env.NINE_ROUTER_API_KEY,
      gemini: !!process.env.GEMINI_API_KEY,
      geminiImage: !!process.env.GEMINI_IMAGE_API_KEY,
    },
  });
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
  const key = b.key || envKeyFor(p, b.op);
  try {
    if (b.op === "test") return Response.json(await test(p, key));
    if (!p.text_model && (b.op === "text" || b.op === "stream")) {
      return Response.json({ ok: false, error: "Model teks belum diisi di profil ini." } satisfies Out);
    }
    if (b.op === "stream") return streamText(p, key, b.system ?? "", b.prompt ?? "");
    if (b.op === "text") return Response.json({ ok: true, text: await text(p, key, b.system ?? "", b.prompt ?? "") } satisfies Out);
    return Response.json({ ok: true, image: await image(p, key, b.prompt ?? "") } satisfies Out);
  } catch (e) {
    if (e instanceof HttpErr) return Response.json({ ok: false, status: e.status, error: e.message } satisfies Out);
    const name = (e as Error)?.name;
    return Response.json({ ok: false, error: name === "TimeoutError" ? `Waktu habis setelah ${genTimeout(p)} detik.` : `Gagal terhubung: ${(e as Error)?.message}` } satisfies Out);
  }
}
