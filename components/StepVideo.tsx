"use client";
import { useEffect, useState } from "react";
import { VIDEO_ENGINES, buildVideoPrompt, flowCreditEstimate, tc } from "@/lib/data";
import type { Shot, VideoEngine } from "@/lib/data";
import { buildLocalFfmpegBat, buildSrtContent, renderZoomVideoInBrowser, triggerDownload } from "@/lib/videoExport";
import { db } from "@/lib/store";
import { cloudList, mergeProjects } from "@/lib/cloudSync";
import type { Ctx } from "./Studio";

const STATUS_LABEL: Record<string, string> = {
  idle: "Belum dibuat",
  queued: "Mengantre",
  generating: "Membuat…",
  done: "Selesai",
  error: "Gagal",
};

export function StepVideo({ p, set, go }: Ctx) {
  const engine: VideoEngine = p.video_engine ?? "omni";
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [render, setRender] = useState<{ percent: number; log: string } | null>(null);
  const [renderErr, setRenderErr] = useState("");
  const [exportMsg, setExportMsg] = useState("");
  const [refreshMsg, setRefreshMsg] = useState("");

  const done = p.shots.filter((s) => s.video_status === "done" && s.video_url).length;
  const est = flowCreditEstimate(p);

  // Worker Flow menulis hasil ke Supabase; tarik pembaruan tiap 30 dtk selama di langkah ini.
  const refreshFromCloud = async (silent = false) => {
    try {
      const [local, remote] = await Promise.all([db.list(), cloudList()]);
      if (!remote.length) return;
      const merged = mergeProjects(local, remote);
      const mine = merged.find((x) => x.id === p.id);
      if (mine && mine.updated_at !== p.updated_at) {
        await db.put(mine);
        set(() => mine);
        if (!silent) setRefreshMsg("Klip baru masuk dari worker Flow.");
      } else if (!silent) setRefreshMsg("Belum ada klip baru dari worker.");
    } catch {
      if (!silent) setRefreshMsg("Gagal memeriksa cloud — coba lagi.");
    }
  };
  useEffect(() => {
    const id = setInterval(() => void refreshFromCloud(true), 30000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.id, p.updated_at]);

  const setShot = (id: string, patch: Partial<Shot>) =>
    set((x) => ({ ...x, shots: x.shots.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));

  const enqueue = (s: Shot) => setShot(s.id, { video_status: "queued", video_engine: engine, video_error: undefined });
  const enqueueAll = () => {
    set((x) => ({
      ...x,
      shots: x.shots.map((s) =>
        s.video_status === "done" && s.video_url ? s : { ...s, video_status: "queued" as const, video_engine: engine, video_error: undefined },
      ),
    }));
  };

  const downloadText = (text: string, filename: string, type: string) => {
    triggerDownload(new Blob([text], { type }), filename);
    setExportMsg(`${filename} diunduh.`);
  };

  const exportZoom = async () => {
    if (!p.shots.length) return;
    setRenderErr("");
    setExportMsg("");
    setRender({ percent: 0, log: "Mulai render zoom..." });
    try {
      const { blob, extension } = await renderZoomVideoInBrowser({
        shots: p.shots,
        onProgress: (percent, log) => setRender({ percent, log }),
      });
      const slug = (p.title || "video").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "video";
      triggerDownload(blob, `${slug}-zoom.${extension}`);
      setRender(null);
      setExportMsg(`Video zoom (.${extension}) diunduh.`);
    } catch (e) {
      setRender(null);
      setRenderErr(`Export gagal: ${(e as Error).message}`);
    }
  };

  if (!p.shots.length) {
    return (
      <section className="page">
        <p className="eyebrow">Langkah 6 dari 6</p>
        <h1>Video jadi</h1>
        <p className="lede">Belum ada shot di Board — video dibuat dari shot, satu klip per shot.</p>
        <div className="row"><button className="btn primary" onClick={() => go(5)}>Ke Board dulu</button></div>
      </section>
    );
  }

  return (
    <section className="page wide">
      <p className="eyebrow">Langkah 6 dari 6</p>
      <h1>Video jadi</h1>
      <p className="lede">Shot di Board berubah jadi klip video lewat Flow, lalu digabung dan di-export sebagai mp4 9:16.</p>

      <div className="panel">
        <div className="credit">
          <span><b>Google Flow</b> · rizkidwisandy1@gmail.com</span>
          <span className="pill pro">PRO</span>
          <span><b>1.038 kredit</b> · reset 1 Des <small className="dim">(terakhir dicek 20 Nov 02:31)</small></span>
        </div>
        <div className="hint">
          {engine === "zoom"
            ? "Zoom gratis tidak memakai kredit dan tidak perlu antre — langsung Export di bawah."
            : `Omni 1.2 Flash 12 kredit/klip · ${est.pending} shot belum punya klip ≈ ${est.total} kredit. Generate jalan di worker Flow (browser) — tiap klip ±1–3 menit, antre satu per satu.`}
        </div>
      </div>

      <h2>Mesin generate</h2>
      <div className="vengines" role="radiogroup" aria-label="Mesin generate video">
        {VIDEO_ENGINES.map((e) => (
          <label key={e.id} className={`vengine ${engine === e.id ? "on" : ""}`}>
            <input type="radio" name="video-engine" checked={engine === e.id}
              onChange={() => set((x) => ({ ...x, video_engine: e.id }))} />
            <span className="name">{e.name}{e.id === "omni" && <span className="pill ok"> Default Flow</span>}</span>
            <span className="desc">{e.desc}</span>
            <span className="cost">{e.cost}</span>
          </label>
        ))}
      </div>

      <h2>Klip per shot</h2>
      <div className="prog">
        <div className="prog-head">
          <span className="prog-label">{done} dari {p.shots.length} klip selesai</span>
          <span className="prog-meta">
            {p.shots.some((s) => s.video_status === "generating") ? "Worker sedang membuat klip…" : "Worker antre satu per satu"}
          </span>
        </div>
        <div className="prog-track"><div className="prog-fill" style={{ width: `${p.shots.length ? (done / p.shots.length) * 100 : 0}%` }} /></div>
      </div>
      <div className="row">
        <button className="btn sm" onClick={() => void refreshFromCloud()}>Periksa klip baru</button>
        {refreshMsg && <span className="dim" style={{ fontSize: "0.85rem" }}>{refreshMsg}</span>}
      </div>

      <div className="vshots">
        {p.shots.map((s, i) => {
          const st = s.video_status ?? "idle";
          const eng = VIDEO_ENGINES.find((e) => e.id === (s.video_engine ?? engine))!;
          return (
            <div key={s.id}>
              <div className="vshot">
                <div className="vthumb">
                  {s.image ? <img src={s.image} alt="" /> : <span>{i + 1}</span>}
                </div>
                <div className="vshot-main">
                  <div className="t">{s.title || `Shot ${i + 1}`}</div>
                  <div className="s">
                    {tc(s.duration_ms)} · {eng.name}
                    {st === "done" && s.video_url ? " · 720p 9:16" : ""}
                  </div>
                  {st === "error" && s.video_error && <div className="s" style={{ color: "var(--danger)" }}>{s.video_error}</div>}
                </div>
                <span className={`vbadge ${st === "done" ? "done" : st === "generating" ? "busy" : st === "error" ? "err" : "idle"}`}>
                  {STATUS_LABEL[st]}
                </span>
                {engine !== "zoom" && st !== "done" && st !== "queued" && st !== "generating" && (
                  <button className="btn sm" onClick={() => enqueue(s)}>Generate</button>
                )}
                {engine !== "zoom" && (st === "queued" || st === "generating") && (
                  <button className="btn sm" onClick={() => setShot(s.id, { video_status: "idle", video_error: undefined })}>Batal</button>
                )}
                {st === "done" && s.video_url && (
                  <>
                    <button className="btn sm" onClick={() => setPlayingId(playingId === s.id ? null : s.id)}>
                      {playingId === s.id ? "Tutup" : "Putar"}
                    </button>
                    <a className="btn sm" href={s.video_url} download={`clip-${i + 1}.mp4`}>Unduh klip</a>
                  </>
                )}
              </div>
              {playingId === s.id && s.video_url && (
                <video className="vpreview" src={s.video_url} controls autoPlay loop playsInline />
              )}
              <details className="fold">
                <summary>Prompt yang dikirim ke Flow</summary>
                <p className="prompt-preview">{buildVideoPrompt(p, s)}</p>
              </details>
            </div>
          );
        })}
      </div>
      {engine !== "zoom" && (
        <div className="row">
          <button className="btn primary" onClick={enqueueAll} disabled={!est.pending}>
            Generate semua ({est.total} kredit)
          </button>
          <button className="btn" onClick={enqueueAll} disabled={!est.pending}>Hanya yang belum</button>
        </div>
      )}

      <h2>Export</h2>
      <div className="panel">
        <div className="row">
          <button className="btn primary" onClick={() => void exportZoom()} disabled={!!render}>Export video (zoom gratis)</button>
          <button className="btn" onClick={() => downloadText(buildSrtContent(p.shots), "captions.srt", "text/plain")}>Unduh .srt</button>
          <button className="btn" onClick={() => downloadText(buildLocalFfmpegBat(p.shots, engine), "render-video.bat", "text/plain")}>Script ffmpeg (.bat)</button>
        </div>
        {render && (
          <div className="prog">
            <div className="prog-head"><span className="prog-label">{render.log}</span><span className="prog-meta">{render.percent}%</span></div>
            <div className="prog-track"><div className="prog-fill" style={{ width: `${render.percent}%` }} /></div>
          </div>
        )}
        {renderErr && <p className="error">{renderErr}</p>}
        {exportMsg && <p className="ok">{exportMsg}</p>}
        <div className="hint">
          Export zoom memakai gambar shot + subtitle — langsung jadi tanpa menunggu Flow. Klip Flow yang sudah selesai ikut di script .bat sebagai clips/sc_N.mp4 (unduh dulu lewat tombol “Unduh klip” di atas, simpan dengan nama itu).
        </div>
      </div>

      <div className="step-foot"><button className="btn" onClick={() => go(5)}>← Kembali ke Board</button></div>
    </section>
  );
}
