"use client";
import { useEffect, useRef, useState } from "react";
import { ANGLES, MOVEMENTS, ROLL_COMBOS, SHOT_TYPES, STORY_STYLES, activeArt, buildPrompt, newShot, retime, rollLabel, tc, uid } from "@/lib/data";
import type { Roll, Shot } from "@/lib/data";
import { shotsFromAi, toCsv, toMarkdown } from "@/lib/parse";
import { downscale, download, readFile } from "@/lib/store";
import type { Ctx } from "./Studio";
import Frame from "./Frame";
import Animatic from "./Animatic";
import Progress from "./Progress";

type Filter = "all" | Roll;
const LANES: { r: Roll; name: string }[] = [
  { r: "A", name: "A-Roll · Utama" },
  { r: "B", name: "B-Roll · Visual" },
  { r: "X", name: "X-Roll · VFX" },
];

function Duration({ ms, onChange }: { ms: number; onChange: (ms: number) => void }) {
  const [t, setT] = useState(String(ms / 1000));
  useEffect(() => { if (Math.round(parseFloat(t) * 1000) !== ms) setT(String(ms / 1000)); }, [ms]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <label className="dur">
      <input type="number" step="0.5" min="0.5" max="30" value={t} aria-label="Durasi (detik)"
        onChange={(e) => { setT(e.target.value); const v = parseFloat(e.target.value); if (v >= 0.5 && v <= 30) onChange(Math.round(v * 1000)); }}
        onBlur={() => setT(String(ms / 1000))} />
      <span>dtk</span>
    </label>
  );
}

function Fold({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(!!value);
  return (
    <details className="fold" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{label}{!open && value && <span className="dim"> · {value.slice(0, 40)}{value.length > 40 ? "…" : ""}</span>}</summary>
      <textarea rows={2} value={value} aria-label={label} onChange={(e) => onChange(e.target.value)} />
    </details>
  );
}

export default function Board(ctx: Ctx) {
  const { p, set, go, hasText, hasImage, aiText, aiImage, openSettings } = ctx;
  const [filter, setFilter] = useState<Filter>("all");
  const [hl, setHl] = useState("");
  const [run, setRun] = useState<{ startedAt: number; phase: "connect" | "think" | "stream"; chars: number; shots: number } | null>(null);
  const [err, setErr] = useState("");
  const [imgRun, setImgRun] = useState<Record<string, { startedAt: number; ctrl: AbortController }>>({});
  const [imgErr, setImgErr] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState("");
  const [play, setPlay] = useState(false);
  const exportMenu = useRef<HTMLDetailsElement>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const busy = !!run;

  const art = activeArt(p);
  const total = p.shots.reduce((a, s) => a + s.duration_ms, 0);
  const shown = filter === "all" ? p.shots : p.shots.filter((s) => s.rolls.includes(filter));
  const setShots = (fn: (s: Shot[]) => Shot[]) => set((x) => ({ ...x, shots: retime(fn(x.shots)) }));
  const patch = (id: string, v: Partial<Shot>) => setShots((ss) => ss.map((s) => (s.id === id ? { ...s, ...v } : s)));
  const move = (i: number, d: number) => setShots((ss) => { const a = [...ss]; const j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; });

  const focusShot = (id: string) => {
    if (filter !== "all" && !shown.some((s) => s.id === id)) setFilter("all");
    requestAnimationFrame(() => document.getElementById(`shot-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }));
    setHl(id);
    setTimeout(() => setHl((h) => (h === id ? "" : h)), 1600);
  };

  const generate = async () => {
    const free = p.shots.filter((s) => !s.locked).length;
    if (free && !confirm(`${free} shot yang tidak dikunci akan diganti hasil generate. Shot yang dikunci tetap di posisinya. Lanjutkan?`)) return;
    const st = STORY_STYLES.find((s) => s.id === p.story_style.preset_id)!;
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    const startedAt = Date.now();
    setRun({ startedAt, phase: "connect", chars: 0, shots: 0 });
    setErr("");
    const r = await aiText(
      [
        p.script.trim() ? `SCRIPT:\n${p.script}` : `PREMIS: ${p.premise || p.title}`,
        `Target durasi total: ${p.target_secs} detik. Gaya: ${st.name}. Beat: ${st.beats.join(" > ")}.`,
        `Aturan gaya: ${p.story_style.rules}`,
        p.character.name && `Karakter: ${p.character.name}. ${p.character.description}`,
        `Pecah menjadi shot. Setiap item: {"title","beat","duration_s" (0.5-30),"rolls" (array dari "A","B","X"; A=utama/karakter, B=visual pendukung, X=VFX/overlay),"shot_type" (salah satu: ${SHOT_TYPES.map((s) => s.id).join(", ")}),"camera_angle" (salah satu: ${ANGLES.join(", ")}),"camera_movement" (salah satu: ${MOVEMENTS.join(", ")}),"action","visual","audio" (VO/dialog/SFX)}.`,
        `Total duration_s mendekati ${p.target_secs}. Isi teks dalam Bahasa Indonesia.`,
      ].filter(Boolean).join("\n\n"),
      "Kamu sutradara storyboard video vertikal 9:16. Balas HANYA dengan array JSON valid, tanpa markdown dan tanpa teks lain.",
      {
        signal: ctrl.signal,
        onProgress: (info) => {
          const shots = (info.text.match(/"title"\s*:/g) ?? []).length;
          setRun({ startedAt, phase: info.phase, chars: info.chars, shots });
        },
      },
    );
    ctrlRef.current = null;
    setRun(null);
    if (r.aborted) return setErr("Generate storyboard dibatalkan.");
    if (!r.ok) return setErr(`${r.status ? `HTTP ${r.status}: ` : ""}${r.error}`);
    try {
      const t = (r.text ?? "").trim();
      const s = t.indexOf("["), e = t.lastIndexOf("]");
      const parsed = s !== -1 && e > s ? JSON.parse(t.slice(s, e + 1)) : JSON.parse(t);
      const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.shots) ? parsed.shots : [];
      const fresh = shotsFromAi(items);
      if (!fresh.length) throw new Error();
      setShots((old) => {
        const out: Shot[] = [];
        for (const x of old) if (x.locked) out.push(x); else if (fresh.length) out.push(fresh.shift()!);
        return [...out, ...fresh];
      });
    } catch {
      setErr("Balasan model bukan JSON shot yang valid. Coba generate ulang, atau pakai model yang lebih patuh format.");
    }
  };

  const upload = async (id: string, f?: File) => {
    if (!f) return;
    try { patch(id, { image: await downscale(await readFile(f, "url")) }); setImgErr((e) => ({ ...e, [id]: "" })); }
    catch (e) { setImgErr((m) => ({ ...m, [id]: (e as Error).message })); }
  };

  const genImage = async (s: Shot) => {
    const ctrl = new AbortController();
    setImgRun((b) => ({ ...b, [s.id]: { startedAt: Date.now(), ctrl } }));
    setImgErr((m) => ({ ...m, [s.id]: "" }));
    const r = await aiImage(buildPrompt(p, s), { signal: ctrl.signal });
    try {
      if (r.aborted) throw new Error("Pembuatan gambar dibatalkan.");
      if (!r.ok || !r.image) throw new Error(`${r.status ? `HTTP ${r.status}: ` : ""}${r.error ?? "Gagal membuat gambar."}`);
      patch(s.id, { image: await downscale(r.image) });
    } catch (e) { setImgErr((m) => ({ ...m, [s.id]: (e as Error).message })); }
    setImgRun((b) => { const n = { ...b }; delete n[s.id]; return n; });
  };

  const copy = async (s: Shot) => {
    await navigator.clipboard.writeText(buildPrompt(p, s));
    setCopied(s.id);
    setTimeout(() => setCopied((c) => (c === s.id ? "" : c)), 1400);
  };

  const remove = (s: Shot) => {
    if ((s.title || s.action || s.image) && !confirm(`Hapus shot "${s.title || "tanpa judul"}"?`)) return;
    setShots((ss) => ss.filter((x) => x.id !== s.id));
  };

  const slug = (p.title || "storyboard").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const exp = (kind: "pdf" | "csv" | "json" | "md") => {
    exportMenu.current?.removeAttribute("open");
    if (kind === "pdf") return setTimeout(() => window.print(), 50);
    if (kind === "csv") return download(`${slug}.csv`, "\ufeff" + toCsv(p.shots), "text/csv;charset=utf-8");
    if (kind === "md") return download(`${slug}.md`, toMarkdown(p), "text/markdown;charset=utf-8");
    // Proyek tidak pernah memuat profil provider atau API key; ekspor = data proyek apa adanya.
    download(`${slug}.sbproj.json`, JSON.stringify(p, null, 2), "application/json");
  };

  return (
    <>
      <div className="board-tools">
        <div className="seg" role="group" aria-label="Filter jalur roll">
          {(["all", "A", "B", "X"] as Filter[]).map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === "all" ? "Semua" : `${f}-Roll`} <span className="dim">{f === "all" ? p.shots.length : p.shots.filter((s) => s.rolls.includes(f)).length}</span>
            </button>
          ))}
        </div>
        <span className="mono total" title="Durasi total / target">{tc(total)} <span className="dim">/ {tc(p.target_secs * 1000)}</span></span>
        <div className="tools-end">
          <button className="btn" onClick={() => { const s = newShot(); setShots((ss) => [...ss, s]); focusShot(s.id); }}>Tambah shot</button>
          <button className="btn" disabled={!hasText || busy} onClick={generate} title={hasText ? "" : "Atur profil Teks di Pengaturan AI"}>
            {busy ? "Menyusun storyboard…" : "Generate storyboard"}
          </button>
          <button className="btn" disabled={!p.shots.length} onClick={() => setPlay(true)}>Putar animatic</button>
          <details className="menu right" ref={exportMenu} onKeyDown={(e) => e.key === "Escape" && exportMenu.current?.removeAttribute("open")}>
            <summary className={`btn primary ${p.shots.length ? "" : "disabled"}`} aria-disabled={!p.shots.length}
              onClick={(e) => !p.shots.length && e.preventDefault()}>Ekspor</summary>
            <div className="pop" role="menu">
              <button className="btn ghost" onClick={() => exp("pdf")}>PDF (cetak kartu 9:16)</button>
              <button className="btn ghost" onClick={() => exp("csv")}>CSV (bisa diimpor ulang)</button>
              <button className="btn ghost" onClick={() => exp("json")}>JSON proyek (tanpa key)</button>
              <button className="btn ghost" onClick={() => exp("md")}>Markdown</button>
            </div>
          </details>
        </div>
      </div>
      {run && (
        <div className="board-msg">
          <Progress
            label={run.phase === "stream" ? "Menyusun storyboard…" : run.phase === "think" ? "Model sedang merancang urutan shot…" : "Menghubungkan ke provider…"}
            detail={run.shots ? `${run.shots} shot terdeteksi (${run.chars} karakter)` : run.chars ? `${run.chars} karakter diterima` : undefined}
            startedAt={run.startedAt}
            percent={run.phase === "stream" ? Math.min(95, 16 + (run.shots / Math.max(5, Math.round(p.target_secs / 4))) * 79) : undefined}
            onCancel={() => ctrlRef.current?.abort()}
          />
        </div>
      )}
      {err && <p className="error board-msg" role="alert">{err}</p>}

      {!p.shots.length ? (
        <div className="empty">
          <h2>Board masih kosong</h2>
          <p>Tempel tabel shot di Langkah 3, susun dari script dengan AI, atau mulai satu per satu.</p>
          <div className="row center">
            <button className="btn primary" onClick={() => go(3)}>Impor tabel shot</button>
            {hasText ? <button className="btn" disabled={busy} onClick={generate}>{busy ? "Menyusun storyboard…" : "Generate dari script"}</button>
              : <button className="btn" onClick={openSettings}>Atur AI untuk generate</button>}
            <button className="btn" onClick={() => setShots(() => [newShot({ title: "Shot 1" })])}>Tambah shot kosong</button>
          </div>
        </div>
      ) : !shown.length ? (
        <div className="empty"><p>Tidak ada shot di {filter}-Roll.</p><button className="btn" onClick={() => setFilter("all")}>Tampilkan semua shot</button></div>
      ) : (
        <div className="board-grid">
          {shown.map((s) => {
            const i = p.shots.indexOf(s);
            const combo = rollLabel(s.rolls);
            return (
              <article key={s.id} id={`shot-${s.id}`} className={`card ${s.locked ? "locked" : ""} ${hl === s.id ? "hl" : ""}`} aria-label={`Shot ${i + 1}`}>
                <header className="card-head">
                  <span className="idx">{String(i + 1).padStart(2, "0")}</span>
                  <span className="mono dim">{tc(s.start_ms)}–{tc(s.start_ms + s.duration_ms)}</span>
                  <Duration ms={s.duration_ms} onChange={(ms) => patch(s.id, { duration_ms: ms })} />
                  <button className={`btn ghost sm lock ${s.locked ? "on" : ""}`} aria-pressed={s.locked} onClick={() => patch(s.id, { locked: !s.locked })}
                    title="Shot terkunci tidak diganti saat generate ulang">{s.locked ? "Terkunci" : "Kunci"}</button>
                </header>

                <div className="card-body">
                  <div className="frame-col">
                    <div className="frame">
                      {s.image ? <img src={s.image} alt={`Gambar shot ${i + 1}`} /> : <Frame shot={s} pal={art.palette} />}
                      {s.rolls.includes("X") && <span className="badge">X-Roll</span>}
                      {imgRun[s.id] && (
                        <div className="frame-busy">
                          <Progress compact label="Membuat gambar…" startedAt={imgRun[s.id].startedAt} onCancel={() => imgRun[s.id]?.ctrl.abort()} />
                        </div>
                      )}
                    </div>
                    <div className="frame-actions">
                      <label className="btn ghost sm">Unggah
                        <input type="file" accept="image/*" hidden onChange={(e) => { upload(s.id, e.target.files?.[0]); e.target.value = ""; }} />
                      </label>
                      {hasImage && <button className="btn ghost sm" disabled={!!imgRun[s.id]} onClick={() => genImage(s)}>Generate</button>}
                      {s.image && <button className="btn ghost sm" onClick={() => patch(s.id, { image: undefined })}>Hapus</button>}
                    </div>
                    {imgErr[s.id] && <p className="error sm" role="alert">{imgErr[s.id]}</p>}
                  </div>

                  <div className="fields">
                    <input className="title-in" value={s.title} placeholder="Judul shot" aria-label="Judul shot" onChange={(e) => patch(s.id, { title: e.target.value })} />
                    <div className="selects">
                      <label><span>Roll</span>
                        <select value={combo} onChange={(e) => patch(s.id, { rolls: ROLL_COMBOS.find((c) => c.label === e.target.value)!.rolls })}>
                          {ROLL_COMBOS.map((c) => <option key={c.label}>{c.label}</option>)}
                        </select>
                      </label>
                      <label><span>Framing</span>
                        <select value={s.shot_type} onChange={(e) => patch(s.id, { shot_type: e.target.value as Shot["shot_type"] })}>
                          {SHOT_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                        </select>
                      </label>
                      <label><span>Angle</span>
                        <select value={s.camera_angle} onChange={(e) => patch(s.id, { camera_angle: e.target.value })}>
                          {ANGLES.map((a) => <option key={a}>{a}</option>)}
                        </select>
                      </label>
                      <label><span>Gerak</span>
                        <select value={s.camera_movement} onChange={(e) => patch(s.id, { camera_movement: e.target.value })}>
                          {MOVEMENTS.map((m) => <option key={m}>{m}</option>)}
                        </select>
                      </label>
                    </div>
                    <textarea rows={3} value={s.action} placeholder="Aksi & ekspresi" aria-label="Aksi dan ekspresi" onChange={(e) => patch(s.id, { action: e.target.value })} />
                  </div>
                </div>

                <Fold label="Visual / B-Roll / VFX" value={s.visual} onChange={(v) => patch(s.id, { visual: v })} />
                <Fold label="Audio / VO / SFX" value={s.audio} onChange={(v) => patch(s.id, { audio: v })} />

                <footer className="card-foot">
                  <button className="btn ghost sm" onClick={() => copy(s)}>{copied === s.id ? "Prompt tersalin" : "Salin prompt"}</button>
                  <span className="spacer" />
                  <button className="btn ghost sm" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Geser ke sebelumnya">←</button>
                  <button className="btn ghost sm" disabled={i === p.shots.length - 1} onClick={() => move(i, 1)} aria-label="Geser ke berikutnya">→</button>
                  <button className="btn ghost sm" onClick={() => setShots((ss) => [...ss.slice(0, i + 1), { ...s, id: uid(), locked: false }, ...ss.slice(i + 1)])}>Duplikat</button>
                  <button className="btn ghost sm danger" onClick={() => remove(s)}>Hapus</button>
                </footer>
              </article>
            );
          })}
        </div>
      )}

      {p.shots.length > 0 && (
        <section className="timeline" aria-label="Timeline">
          <div className="tl-scroll">
            <div className="tl-inner" style={{ minWidth: `max(100%, ${Math.ceil(total / 1000) * 14 + 96}px)` }}>
              <div className="tl-row ruler">
                <span className="tl-label">Timeline</span>
                <div className="tl-track">
                  {Array.from({ length: Math.floor(total / 5000) + 1 }, (_, k) => (
                    <span key={k} className="tick mono" style={{ left: `${(k * 5000 / total) * 100}%` }}>{tc(k * 5000)}</span>
                  ))}
                </div>
              </div>
              {LANES.map(({ r, name }) => (
                <div key={r} className={`tl-row lane-${r}`}>
                  <span className="tl-label">{name}</span>
                  <div className="tl-track">
                    {p.shots.map((s, i) => s.rolls.includes(r) && (
                      <button key={s.id} className={`clip ${hl === s.id ? "hl" : ""}`}
                        style={{ left: `${(s.start_ms / total) * 100}%`, width: `${(s.duration_ms / total) * 100}%` }}
                        onClick={() => focusShot(s.id)} aria-label={`Shot ${i + 1}: ${s.title}, ${tc(s.start_ms)}`} title={`${i + 1}. ${s.title}`}>
                        <span>{i + 1}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {play && <Animatic p={p} onClose={() => setPlay(false)} />}

      <div className="print-sheet" aria-hidden="true">
        <h1>{p.title}</h1>
        {p.premise && <p>{p.premise}</p>}
        <p className="mono">{p.shots.length} shot · {tc(total)} · gaya visual {art.name}</p>
        <div className="print-grid">
          {p.shots.map((s, i) => (
            <div key={s.id} className="print-card">
              <div className="frame">{s.image ? <img src={s.image} alt="" /> : <Frame shot={s} pal={art.palette} />}</div>
              <div>
                <strong>{i + 1}. {s.title}</strong>
                <div className="mono">{tc(s.start_ms)}–{tc(s.start_ms + s.duration_ms)} · {rollLabel(s.rolls)}</div>
                <div>{s.shot_type} · {s.camera_angle} · {s.camera_movement}</div>
                {s.action && <p>{s.action}</p>}
                {s.visual && <p><em>Visual:</em> {s.visual}</p>}
                {s.audio && <p><em>Audio:</em> {s.audio}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
