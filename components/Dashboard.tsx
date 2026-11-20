"use client";
import { VIDEO_ENGINES } from "@/lib/data";
import type { Project, Shot } from "@/lib/data";

/** Apakah proyek ini pernah memakai video (ada shot yang masuk antrean/generate)? */
export const usesVideo = (p: Project) =>
  p.shots.some((s) => s.video_status === "queued" || s.video_status === "generating" || s.video_status === "done" || s.video_status === "error");

/** Satu shot dianggap selesai bila klip videonya done — atau, bila proyek tidak
    memakai video sama sekali, bila gambar shot-nya sudah ada. */
export const isShotFinished = (p: Project, s: Shot) =>
  s.video_status === "done" || (!usesVideo(p) && !!s.image);

/** Proyek selesai: punya shot dan semua shot-nya selesai (definisi di atas). */
export const isProjectDone = (p: Project) =>
  p.shots.length > 0 && p.shots.every((s) => isShotFinished(p, s));

const engineName = (p: Project, s?: Shot) =>
  VIDEO_ENGINES.find((e) => e.id === (s?.video_engine ?? p.video_engine ?? "omni"))?.name ?? "Omni 1.2 Flash";

const secs = (ms: number) => `${Math.max(1, Math.round(ms / 1000))} dtk`;

const fmtDate = (ts: number) =>
  new Intl.DateTimeFormat("id-ID", { timeZone: "Asia/Jakarta", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));

function shotBadge(p: Project, s: Shot): { label: string; cls: string } {
  if (s.video_status === "done") return { label: "Selesai", cls: "done" };
  if (s.video_status === "generating") return { label: "Membuat…", cls: "busy" };
  if (s.video_status === "queued") return { label: "Mengantre", cls: "idle" };
  if (s.video_status === "error") return { label: "Gagal", cls: "err" };
  if (s.image) return { label: "Gambar siap", cls: "idle" };
  return { label: "Belum dibuat", cls: "idle" };
}

function ShotRow({ p, s, i }: { p: Project; s: Shot; i: number }) {
  const b = shotBadge(p, s);
  return (
    <div className="shot">
      <div className="thumb" aria-hidden="true">
        {s.image ? <img src={s.image} alt="" /> : i + 1}
      </div>
      <div>
        <div className="t">{s.title || `Shot ${i + 1}`}</div>
        <div className="s">{secs(s.duration_ms)} · {engineName(p, s)}</div>
      </div>
      <span className={`dbadge ${b.cls}`}>{b.label}</span>
    </div>
  );
}

function ProjectCard({ p, done, onOpen }: { p: Project; done: boolean; onOpen: (p: Project) => void }) {
  const finished = p.shots.filter((s) => isShotFinished(p, s)).length;
  const total = p.shots.length;
  const pct = total ? Math.round((finished / total) * 100) : 0;
  const video = usesVideo(p);
  const meta = video
    ? `${total} shot · ${engineName(p)} · 9:16`
    : `${total} shot · gambar saja · 9:16`;
  const progressText = video
    ? `${finished} dari ${total} klip selesai`
    : `${finished} dari ${total} gambar siap`;
  const shown = p.shots.slice(0, 3);
  return (
    <div className="panel proj">
      <div className="proj-head">
        <span className="t">{p.title || "Proyek tanpa judul"}</span>
        <span className={`pill ${done ? "ok" : "warn"}`}>{done ? "Selesai" : "Mengantre"}</span>
        <span className="meta">{meta}</span>
      </div>
      <div className="prog-track"><div className="prog-fill grad" style={{ width: `${pct}%` }} /></div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span style={{ fontSize: ".85rem", color: "var(--ink-2)" }}>{progressText} · terakhir diubah {fmtDate(p.updated_at)}</span>
        <button className="btn sm primary" onClick={() => onOpen(p)}>Buka proyek</button>
      </div>
      {shown.length > 0 && (
        <div className="shots">
          {shown.map((s, i) => <ShotRow key={s.id} p={p} s={s} i={i} />)}
          {total > shown.length && <div className="more">+ {total - shown.length} klip lagi</div>}
        </div>
      )}
    </div>
  );
}

export default function Dashboard({ projects, onOpen, onNew }: {
  projects: Project[];
  onOpen: (p: Project) => void;
  onNew: () => void;
}) {
  const sorted = [...projects].sort((a, b) => b.updated_at - a.updated_at);
  const totalShots = sorted.reduce((n, p) => n + p.shots.length, 0);
  const doneClips = sorted.reduce((n, p) => n + p.shots.filter((s) => s.video_status === "done").length, 0);
  const queuedClips = sorted.reduce((n, p) => n + p.shots.filter((s) => s.video_status === "queued" || s.video_status === "generating").length, 0);
  const running = sorted.filter((p) => p.shots.length > 0 && !isProjectDone(p));
  const finished = sorted.filter((p) => isProjectDone(p));
  const empty = sorted.filter((p) => p.shots.length === 0);

  return (
    <div className="page wide">
      <p className="eyebrow">Dashboard</p>
      <h1>Proyek yang sedang jalan</h1>
      <p className="lede">Semua proyek, antrean video, dan status pengerjaan dalam satu tempat.</p>

      <div className="stats">
        <div className="stat"><span className="n">{sorted.length}</span><span className="l">Proyek</span><span className="s">lokal + cloud</span></div>
        <div className="stat"><span className="n">{totalShots}</span><span className="l">Total shot</span><span className="s">di semua proyek</span></div>
        <div className="stat"><span className="n">{doneClips}</span><span className="l">Klip video selesai</span><span className="s">dari semua proyek</span></div>
        <div className="stat"><span className="n">{queuedClips}</span><span className="l">Klip mengantre</span><span className="s">menunggu dibuat</span></div>
      </div>

      <h2>Sedang berjalan</h2>
      {running.length === 0 ? (
        <div className="panel"><p className="dim" style={{ margin: 0 }}>Tidak ada proyek yang sedang berjalan. Semua proyek sudah selesai, atau belum ada shot sama sekali.</p></div>
      ) : (
        running.map((p) => <ProjectCard key={p.id} p={p} done={false} onOpen={onOpen} />)
      )}

      <h2>Selesai</h2>
      {finished.length === 0 ? (
        <div className="panel"><p className="dim" style={{ margin: 0 }}>Belum ada proyek yang selesai. Proyek masuk ke sini bila semua shot-nya sudah punya klip video — atau, bila proyek tidak memakai video, bila semua shot sudah punya gambar.</p></div>
      ) : (
        finished.map((p) => <ProjectCard key={p.id} p={p} done onOpen={onOpen} />)
      )}

      <h2>Proyek lain</h2>
      {empty.length === 0 ? (
        <div className="panel"><p className="dim" style={{ margin: 0 }}>Tidak ada proyek kosong.</p></div>
      ) : (
        empty.map((p) => (
          <div className="panel proj" key={p.id}>
            <div className="proj-head">
              <span className="t">{p.title || "Proyek tanpa judul"}</span>
              <span className="meta">0 shot · baru dibuat</span>
            </div>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <span style={{ fontSize: ".85rem", color: "var(--ink-2)" }}>Belum ada isi — buka untuk mulai dari Tema.</span>
              <button className="btn sm" onClick={() => onOpen(p)}>Buka proyek</button>
            </div>
          </div>
        ))
      )}

      <div className="hint">Dashboard membaca proyek dari penyimpanan lokal + cloud (Supabase).</div>
      <div className="dash-foot"><button className="btn primary" onClick={onNew}>+ Proyek baru</button></div>
    </div>
  );
}
