"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { newProject, PROVIDER_KINDS, DEFAULT_GEMINI_ID, DEFAULT_WEB_ID } from "@/lib/data";
import type { Project } from "@/lib/data";
import { ai, db, fetchServerKeys, getKey, loadSettings, readFile, saveSettings } from "@/lib/store";
import type { AiOpts, AiResult, ServerKeys, Settings as S } from "@/lib/store";
import { cloudDelete, cloudList, cloudUpsert, mergeProjects } from "@/lib/cloudSync";
import { StepCharacter, StepScript, StepStyle, StepTheme } from "./Steps";
import Board from "./Board";
import Settings from "./Settings";

export type Ctx = {
  p: Project;
  set: (fn: (p: Project) => Project) => void;
  go: (step: number) => void;
  aiText: (prompt: string, system: string, opts?: AiOpts) => Promise<AiResult>;
  aiImage: (prompt: string, opts?: AiOpts) => Promise<AiResult>;
  hasText: boolean;
  hasImage: boolean;
  openSettings: () => void;
};

const STEPS = [
  { full: "Tema", short: "Tema" },
  { full: "Gaya Cerita", short: "Gaya" },
  { full: "Script", short: "Script" },
  { full: "Karakter & Visual", short: "Visual" },
  { full: "Board", short: "Board" },
];

export default function Studio() {
  const [settings, setSettings] = useState<S | null>(null);
  const [p, setP] = useState<Project | null>(null);
  const [list, setList] = useState<Project[]>([]);
  const [step, setStep] = useState(1);
  const [save, setSave] = useState<"saved" | "pending" | "error">("saved");
  const [showSettings, setShowSettings] = useState(false);
  const [loadErr, setLoadErr] = useState("");
  const [serverKeys, setServerKeys] = useState<ServerKeys | null>(null);
  const skipSave = useRef(true);
  const menu = useRef<HTMLDetailsElement>(null);
  const booted = useRef(false);

  const updateSettings = useCallback((fn: (s: S) => S) => setSettings((s) => { const n = fn(s!); saveSettings(n); return n; }), []);

  const openProject = useCallback((proj: Project) => {
    skipSave.current = true;
    setP(proj);
    setStep(proj.shots.length ? 5 : 1);
    updateSettings((x) => ({ ...x, lastProjectId: proj.id }));
  }, [updateSettings]);

  useEffect(() => {
    if (booted.current) return; // StrictMode menjalankan efek dua kali di dev
    booted.current = true;
    const s = loadSettings();
    setSettings(s);
    fetchServerKeys().then(setServerKeys);
    db.list().then(async (all) => {
      const remote = await cloudList();
      if (remote.length) {
        const merged = mergeProjects(all, remote);
        for (const m of merged) {
          const local = all.find((x) => x.id === m.id);
          if (!local || local.updated_at !== m.updated_at) await db.put(m);
        }
        all = merged;
      }
      let cur = all.find((x) => x.id === s.lastProjectId) ?? all.sort((a, b) => b.updated_at - a.updated_at)[0];
      if (!cur) { cur = newProject(); await db.put(cur); all = [cur]; }
      setList(all);
      openProject(cur);
    }).catch((e) => setLoadErr(`Penyimpanan lokal tidak bisa dibuka (${e?.message ?? e}). Pastikan browser tidak dalam mode yang memblokir IndexedDB.`));
  }, [openProject]);

  useEffect(() => { if (settings) document.documentElement.dataset.theme = settings.theme; }, [settings?.theme]);

  // Tutup menu <details> saat klik di luar area menu, seperti menu aplikasi desktop.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((el) => {
        if (!el.contains(e.target as Node)) el.removeAttribute("open");
      });
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Autosave dengan debounce 2 detik.
  useEffect(() => {
    if (!p) return;
    if (skipSave.current) { skipSave.current = false; return; }
    setSave("pending");
    const id = setTimeout(() => {
      const out = { ...p, updated_at: Date.now() };
      db.put(out).then(() => { setSave("saved"); setList((l) => [out, ...l.filter((x) => x.id !== out.id)]); cloudUpsert(out); }).catch(() => setSave("error"));
    }, 2000);
    return () => clearTimeout(id);
  }, [p]);

  const set = useCallback((fn: (p: Project) => Project) => setP((x) => (x ? fn(x) : x)), []);

  if (loadErr) return <div className="center-msg" role="alert">{loadErr}</div>;
  if (!p || !settings) return <div className="center-msg">Membuka proyek…</div>;

  const textProfile = settings.profiles.find((x) => x.id === settings.textProfileId);
  const imageProfile = settings.profiles.find((x) => x.id === settings.imageProfileId);
  const hasSrv = (id: string, op: "text" | "image") => {
    if (!serverKeys) return false;
    if (id === DEFAULT_WEB_ID) return serverKeys.web;
    if (id === DEFAULT_GEMINI_ID) return op === "image" ? (serverKeys.geminiImage || serverKeys.gemini) : serverKeys.gemini;
    return false;
  };
  const ready = (prof?: typeof textProfile, op: "text" | "image" = "text") => !!prof && (!PROVIDER_KINDS.find((k) => k.id === prof.kind)!.needsKey || !!getKey(prof.id) || hasSrv(prof.id, op));

  const ctx: Ctx = {
    p, set, go: setStep,
    hasText: ready(textProfile, "text"),
    hasImage: ready(imageProfile, "image") && !!imageProfile?.image_model,
    aiText: (prompt, system, opts) => textProfile ? ai(textProfile, "text", prompt, system, opts) : Promise.resolve({ ok: false, error: "Belum ada profil untuk peran Teks. Atur di Pengaturan AI." }),
    aiImage: (prompt, opts) => imageProfile ? ai(imageProfile, "image", prompt, "", opts) : Promise.resolve({ ok: false, error: "Belum ada profil untuk peran Gambar. Atur di Pengaturan AI." }),
    openSettings: () => setShowSettings(true),
  };

  const closeMenu = () => menu.current?.removeAttribute("open");
  const createProject = async () => { const n = newProject(); await db.put(n); cloudUpsert(n); setList((l) => [n, ...l]); openProject(n); closeMenu(); };
  const removeProject = async (x: Project) => {
    if (!confirm(`Hapus proyek "${x.title}"? Tindakan ini tidak bisa dibatalkan.`)) return;
    await db.del(x.id);
    cloudDelete(x.id);
    const rest = list.filter((y) => y.id !== x.id);
    setList(rest);
    if (x.id === p.id) rest[0] ? openProject(rest[0]) : createProject();
  };
  const importJson = async (f?: File) => {
    if (!f) return;
    try {
      const data = JSON.parse(await readFile(f, "text"));
      if (!Array.isArray(data?.shots)) throw new Error("bukan file proyek Storyboard Studio");
      const proj: Project = { ...newProject(), ...data, id: crypto.randomUUID(), updated_at: Date.now() };
      await db.put(proj);
      cloudUpsert(proj);
      setList((l) => [proj, ...l]);
      openProject(proj);
      closeMenu();
    } catch (e) {
      alert(`File tidak bisa dibuka: ${(e as Error).message}`);
    }
  };

  return (
    <div className="app">
      <a className="skip" href="#konten">Langsung ke konten</a>
      <header className="bar">
        <div className="bar-start">
          <span className="logo-mark" aria-hidden="true">S</span>
          <span className="brand">Storyboard Studio</span>
          <details className="menu" ref={menu} onKeyDown={(e) => e.key === "Escape" && closeMenu()}>
            <summary className="btn ghost proj-name" title="Ganti proyek">{p.title || "Proyek tanpa judul"}</summary>
            <div className="pop" role="menu">
              <button className="btn" onClick={createProject}>Proyek baru</button>
              <label className="btn">Buka file proyek (.json)
                <input type="file" accept=".json,application/json" hidden onChange={(e) => { importJson(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              <div className="pop-title">Proyek tersimpan di perangkat ini</div>
              <ul className="proj-list">
                {list.map((x) => (
                  <li key={x.id} className={x.id === p.id ? "on" : ""}>
                    <button className="link" onClick={() => { openProject(x); closeMenu(); }}>
                      {x.title || "Proyek tanpa judul"} <small>{x.shots.length} shot</small>
                    </button>
                    <button className="btn ghost sm" onClick={() => removeProject(x)} aria-label={`Hapus ${x.title}`}>Hapus</button>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </div>

        <nav className="steps" aria-label="Langkah kerja">
          {STEPS.map((s, i) => (
            <button key={s.full} className="step" aria-current={step === i + 1 ? "step" : undefined} onClick={() => setStep(i + 1)}>
              <span className="num">{i + 1}</span>
              <span className="step-full">{s.full}</span>
              <span className="step-short">{s.short}</span>
            </button>
          ))}
        </nav>

        <div className="bar-end">
          <span className={`save ${save}`} role="status">
            {save === "saved" ? "Tersimpan" : save === "pending" ? "Menyimpan…" : "Gagal menyimpan"}
          </span>
          <button className="btn ghost" onClick={() => setShowSettings(true)}>
            {ctx.hasText ? `AI: ${textProfile!.name}` : "AI belum diatur"}
          </button>
          <button className="btn ghost" onClick={() => updateSettings((s) => ({ ...s, theme: s.theme === "dark" ? "light" : "dark" }))}>
            {settings.theme === "dark" ? "Tema terang" : "Tema gelap"}
          </button>
        </div>
      </header>

      <main id="konten" className={step === 5 ? "main board-main" : "main"}>
        {step === 1 && <StepTheme {...ctx} />}
        {step === 2 && <StepStyle {...ctx} />}
        {step === 3 && <StepScript {...ctx} />}
        {step === 4 && <StepCharacter {...ctx} />}
        {step === 5 && <Board {...ctx} />}
      </main>

      {showSettings && <Settings settings={settings} update={updateSettings} onClose={() => setShowSettings(false)} />}
    </div>
  );
}
