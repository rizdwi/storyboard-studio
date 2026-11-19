"use client";
// Penyimpanan lokal: proyek (termasuk gambar) di IndexedDB, pengaturan & key di localStorage.
// Key tidak pernah masuk ke objek proyek, sehingga tidak ikut autosave maupun ekspor.
import { newProfile, defaultProfiles, DEFAULT_HYDROGEN_ID, DEFAULT_GEMINI_ID } from "./data";
import type { Project, ProviderProfile } from "./data";

const DB = "storyboard-studio", STORE = "projects";
const open = () =>
  new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id" });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
const tx = async <T,>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) => {
  const db = await open();
  return new Promise<T>((res, rej) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
};

export const db = {
  list: () => tx<Project[]>("readonly", (s) => s.getAll()),
  get: (id: string) => tx<Project | undefined>("readonly", (s) => s.get(id)),
  put: (p: Project) => tx("readwrite", (s) => s.put(p)),
  del: (id: string) => tx("readwrite", (s) => s.delete(id)),
};

export interface Settings {
  theme: "dark" | "light";
  profiles: ProviderProfile[];
  textProfileId: string;
  imageProfileId: string;
  lastProjectId: string;
}

const SKEY = "sbs.settings", KKEY = "sbs.keys";
export const loadSettings = (): Settings => {
  const fallback: Settings = { theme: "dark", profiles: defaultProfiles(), textProfileId: DEFAULT_HYDROGEN_ID, imageProfileId: DEFAULT_GEMINI_ID, lastProjectId: "" };
  try {
    const s: Settings = { ...fallback, ...JSON.parse(localStorage.getItem(SKEY) || "{}") };
    // Migrasi: tambahkan profil bawaan yang belum ada (pengguna lama tetap memakai pilihannya sendiri).
    for (const d of defaultProfiles()) if (!s.profiles.some((p) => p.id === d.id)) s.profiles.push(d);
    if (!s.textProfileId) s.textProfileId = DEFAULT_HYDROGEN_ID;
    if (!s.imageProfileId) s.imageProfileId = DEFAULT_GEMINI_ID;
    return s;
  } catch { return fallback; }
};
export const saveSettings = (s: Settings) => localStorage.setItem(SKEY, JSON.stringify(s));

const keys = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(KKEY) || "{}"); } catch { return {}; } };
export const getKey = (profileId: string) => keys()[profileId] ?? "";
export const setKey = (profileId: string, key: string) => {
  const k = keys();
  if (key) k[profileId] = key; else delete k[profileId];
  localStorage.setItem(KKEY, JSON.stringify(k));
};
export const keyHint = (profileId: string) => { const k = getKey(profileId); return k ? `••••${k.slice(-4)}` : ""; };

/** Status key server (tanpa nilai): UI memakai ini untuk menandai profil bawaan sebagai siap. */
export type ServerKeys = { hydrogen: boolean; gemini: boolean; geminiImage: boolean };
let serverKeysCache: ServerKeys | null = null;
export const fetchServerKeys = async (): Promise<ServerKeys> => {
  if (serverKeysCache) return serverKeysCache;
  try {
    const r = await fetch("/api/ai");
    const j = await r.json();
    serverKeysCache = {
      hydrogen: !!j?.serverKeys?.hydrogen,
      gemini: !!j?.serverKeys?.gemini,
      geminiImage: !!j?.serverKeys?.geminiImage,
    };
  } catch { serverKeysCache = { hydrogen: false, gemini: false, geminiImage: false }; }
  return serverKeysCache;
};
export const serverKeyFor = (profileId: string, op: "text" | "image"): boolean => {
  if (!serverKeysCache) return false;
  if (profileId === DEFAULT_HYDROGEN_ID) return serverKeysCache.hydrogen;
  if (profileId === DEFAULT_GEMINI_ID) return op === "image" ? (serverKeysCache.geminiImage || serverKeysCache.gemini) : serverKeysCache.gemini;
  return false;
};

export type AiProgress = {
  phase: "connect" | "think" | "stream";
  text: string;
  chars: number;
};

export type AiOpts = {
  signal?: AbortSignal;
  onProgress?: (info: AiProgress) => void;
};

export type AiResult = { ok: boolean; status?: number; text?: string; image?: string; error?: string; aborted?: boolean };

const isRemoteHost = () => typeof window !== "undefined" && !["localhost", "127.0.0.1"].includes(window.location.hostname);
const isLoopbackUrl = (raw: string) => {
  try { return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(new URL(raw).hostname); } catch { return false; }
};

/** Koneksi langsung dari browser untuk Ollama/endpoint localhost saat aplikasi dibuka dari domain Vercel. */
async function directLocalAi(profile: ProviderProfile, op: "test" | "text", prompt: string, system: string, opts?: AiOpts): Promise<AiResult> {
  const base = profile.base_url.replace(/\/+$/, "");
  const headers: Record<string, string> = { "content-type": "application/json" };
  const key = getKey(profile.id);
  if (key) headers.authorization = `Bearer ${key}`;
  try {
    if (op === "test") {
      const r = await fetch(`${base}/models`, { headers, signal: opts?.signal });
      if (!r.ok) return { ok: false, status: r.status, error: await r.text() || r.statusText };
      const j = await r.json().catch(() => ({}));
      const n = (j?.data ?? j?.models ?? []).length;
      return { ok: true, status: r.status, text: n ? `${n} model tersedia` : "Terhubung" };
    }
    if (!profile.text_model) return { ok: false, error: "Model teks belum diisi di profil ini." };
    opts?.onProgress?.({ phase: "connect", text: "", chars: 0 });
    const r = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers,
      signal: opts?.signal,
      body: JSON.stringify({
        model: profile.text_model,
        stream: true,
        temperature: profile.temperature,
        max_tokens: profile.max_output_tokens,
        messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      }),
    });
    if (!r.ok) return { ok: false, status: r.status, error: (await r.text()).slice(0, 260) || r.statusText };
    if (!r.body) return { ok: false, error: "Respons stream kosong dari endpoint lokal." };
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "", full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const l of lines) {
        const t = l.trim();
        if (!t.startsWith("data:")) continue;
        const p = t.slice(5).trim();
        if (!p || p === "[DONE]") continue;
        try {
          const j = JSON.parse(p);
          const d = j?.choices?.[0]?.delta;
          if (d?.content) { full += d.content; opts?.onProgress?.({ phase: "stream", text: full, chars: full.length }); }
          else if (d?.reasoning_content || d?.reasoning) opts?.onProgress?.({ phase: "think", text: full, chars: full.length });
        } catch {}
      }
    }
    return { ok: true, text: full };
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return { ok: false, aborted: true, error: "Generasi dibatalkan." };
    return { ok: false, error: `Gagal menghubungi localhost: ${(e as Error).message}. Pastikan Ollama berjalan dengan OLLAMA_ORIGINS=*` };
  }
}

export async function ai(profile: ProviderProfile, op: "test" | "text" | "image", prompt = "", system = "", opts?: AiOpts): Promise<AiResult> {
  if ((op === "test" || op === "text") && isRemoteHost() && isLoopbackUrl(profile.base_url)) {
    return directLocalAi(profile, op, prompt, system, opts);
  }
  try {
    if (op === "text") {
      opts?.onProgress?.({ phase: "connect", text: "", chars: 0 });
      const r = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: opts?.signal,
        body: JSON.stringify({ profile, key: getKey(profile.id), op: "stream", prompt, system }),
      });
      const ctype = r.headers.get("content-type") || "";
      if (ctype.includes("application/json")) return await r.json();
      if (!r.body) return { ok: false, error: "Stream tidak tersedia." };

      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "", full = "";
      let errOut: AiResult | null = null;

      const processLine = (line: string) => {
        if (!line.trim()) return;
        try {
          const msg = JSON.parse(line);
          if (msg.t === "start") opts?.onProgress?.({ phase: "connect", text: full, chars: full.length });
          else if (msg.t === "think") opts?.onProgress?.({ phase: "think", text: full, chars: full.length });
          else if (msg.t === "d" && typeof msg.c === "string") {
            full += msg.c;
            opts?.onProgress?.({ phase: "stream", text: full, chars: full.length });
          } else if (msg.t === "err") {
            errOut = { ok: false, status: msg.status, error: msg.error || "Terjadi kesalahan saat generate." };
          }
        } catch {}
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const l of lines) processLine(l);
      }
      if (buf.trim()) processLine(buf);

      if (errOut) return full.trim() ? { ...(errOut as AiResult), text: full } : errOut;
      return { ok: true, text: full };
    }

    const r = await fetch("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: opts?.signal,
      body: JSON.stringify({ profile, key: getKey(profile.id), op, prompt, system }),
    });
    return await r.json();
  } catch (e) {
    if ((e as Error)?.name === "AbortError") return { ok: false, aborted: true, error: "Generasi dibatalkan." };
    return { ok: false, error: `Koneksi terputus: ${(e as Error).message}` };
  }
}

/** Perkecil gambar ke tinggi maks 960px (JPEG) supaya proyek tetap ringan di IndexedDB. */
export function downscale(src: string, maxH = 960): Promise<string> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxH / img.height);
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
      res(c.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => rej(new Error("Gambar tidak bisa dibaca."));
    img.src = src;
  });
}

export const readFile = (f: File, as: "text" | "url") =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    as === "text" ? r.readAsText(f) : r.readAsDataURL(f);
  });

export function download(name: string, content: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
