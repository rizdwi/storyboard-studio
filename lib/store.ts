"use client";
// Penyimpanan lokal: proyek (termasuk gambar) di IndexedDB, pengaturan & key di localStorage.
// Key tidak pernah masuk ke objek proyek, sehingga tidak ikut autosave maupun ekspor.
import { newProfile } from "./data";
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
  const fallback: Settings = { theme: "dark", profiles: [newProfile("OpenAi")], textProfileId: "", imageProfileId: "", lastProjectId: "" };
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(SKEY) || "{}") }; } catch { return fallback; }
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

export type AiResult = { ok: boolean; status?: number; text?: string; image?: string; error?: string };
export async function ai(profile: ProviderProfile, op: "test" | "text" | "image", prompt = "", system = ""): Promise<AiResult> {
  try {
    const r = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ profile, key: getKey(profile.id), op, prompt, system }) });
    return await r.json();
  } catch (e) {
    return { ok: false, error: `Server lokal tidak merespons: ${(e as Error).message}` };
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
