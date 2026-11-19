"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { activeArt, rollLabel, tc } from "@/lib/data";
import type { Project } from "@/lib/data";
import Frame from "./Frame";

function cameraTransform(move: string, p: number, tMs: number): string {
  switch (move) {
    case "Slow Push-In": return `scale(${(1 + p * 0.14).toFixed(4)})`;
    case "Slow Pull-Out": return `scale(${(1.14 - p * 0.14).toFixed(4)})`;
    case "Dolly Zoom (Vertigo)": return `scale(${(1.02 + p * 0.18).toFixed(4)}) translateY(${((0.5 - p) * 3).toFixed(2)}%)`;
    case "Pan Left": return `scale(1.14) translateX(${(-6 + p * 12).toFixed(2)}%)`;
    case "Pan Right": return `scale(1.14) translateX(${(6 - p * 12).toFixed(2)}%)`;
    case "Whip Pan": return `scale(1.18) translateX(${(-Math.tanh((p - 0.5) * 7) * 10).toFixed(2)}%)`;
    case "Tilt Up": return `scale(1.14) translateY(${(-6 + p * 12).toFixed(2)}%)`;
    case "Tilt Down": return `scale(1.14) translateY(${(6 - p * 12).toFixed(2)}%)`;
    case "Tracking": return `scale(1.12) translateX(${(5 - p * 10).toFixed(2)}%) translateY(${(Math.sin(p * Math.PI * 2) * 0.8).toFixed(2)}%)`;
    case "Crane Up": return `scale(${(1.14 - p * 0.08).toFixed(4)}) translateY(${(-5 + p * 10).toFixed(2)}%)`;
    case "Crane Down": return `scale(${(1.06 + p * 0.08).toFixed(4)}) translateY(${(5 - p * 10).toFixed(2)}%)`;
    case "Handheld Shaky": return `scale(1.08) translate(${(Math.sin(tMs / 170) * 1.4).toFixed(2)}%, ${(Math.cos(tMs / 210) * 1.2).toFixed(2)}%) rotate(${(Math.sin(tMs / 290) * 0.9).toFixed(2)}deg)`;
    case "Orbit 360°": return `scale(1.12) translateX(${(Math.sin(p * Math.PI * 2) * 5).toFixed(2)}%) rotate(${(Math.sin(p * Math.PI * 2) * 1.8).toFixed(2)}deg)`;
    case "Snorricam": return `scale(1.07) rotate(${(Math.sin(tMs / 160) * 1.8).toFixed(2)}deg) translateY(${(Math.cos(tMs / 130) * 1.1).toFixed(2)}%)`;
    default: return "none";
  }
}

export default function Animatic({ p, onClose }: { p: Project; onClose: () => void }) {
  const shots = p.shots;
  const total = useMemo(() => shots.reduce((a, s) => a + s.duration_ms, 0), [shots]);
  const art = activeArt(p);

  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [loop, setLoop] = useState(true);
  const [reduced, setReduced] = useState(false);
  const playBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    playBtn.current?.focus();
  }, []);

  useEffect(() => {
    if (!playing || !total) return;
    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = now - prev;
      prev = now;
      setElapsed((e) => {
        const next = e + dt;
        if (next >= total) {
          if (loop) return next % total;
          setPlaying(false);
          return total;
        }
        return next;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, loop, total]);

  const idx = useMemo(() => {
    const found = shots.findIndex((s) => elapsed < s.start_ms + s.duration_ms);
    return found === -1 ? Math.max(0, shots.length - 1) : found;
  }, [shots, elapsed]);

  const shot = shots[idx];
  const jump = (i: number) => {
    const target = shots[Math.max(0, Math.min(shots.length - 1, i))];
    if (target) setElapsed(target.start_ms);
  };
  const togglePlay = () => {
    if (!playing && elapsed >= total) setElapsed(0);
    setPlaying((v) => !v);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === " " && (e.target as HTMLElement)?.tagName !== "BUTTON") { e.preventDefault(); togglePlay(); }
      else if (e.key === "ArrowLeft") jump(idx - 1);
      else if (e.key === "ArrowRight") jump(idx + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!shot) return null;
  const localMs = Math.max(0, Math.min(shot.duration_ms, elapsed - shot.start_ms));
  const progress = shot.duration_ms ? localMs / shot.duration_ms : 0;
  const transform = reduced ? "none" : cameraTransform(shot.camera_movement, progress, elapsed);

  return (
    <div className="backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal animatic-modal" role="dialog" aria-modal="true" aria-labelledby="animatic-title">
        <header className="modal-head">
          <div>
            <h2 id="animatic-title">Pratinjau Animatic 9:16</h2>
            <p className="dim mono">{tc(elapsed)} / {tc(total)} · Shot {idx + 1} dari {shots.length}</p>
          </div>
          <button className="btn ghost" onClick={onClose}>Tutup (Esc)</button>
        </header>

        <div className="animatic-body">
          <div className="animatic-stage">
            <div className="animatic-frame">
              <div className="animatic-cam" style={{ transform }}>
                {shot.image ? <img src={shot.image} alt={`Shot ${idx + 1}: ${shot.title}`} /> : <Frame shot={shot} pal={art.palette} />}
              </div>
              {shot.rolls.includes("X") && <span className="badge">X-Roll</span>}
              {shot.audio && <div className="subtitle" role="region" aria-label="Dialog dan VO">{shot.audio}</div>}
            </div>
          </div>

          <div className="animatic-meta">
            <div className="meta-head">
              <span className="idx">{String(idx + 1).padStart(2, "0")}</span>
              <h3>{shot.title || `Shot ${idx + 1}`}</h3>
            </div>
            <dl className="meta-list">
              <div><dt>Roll</dt><dd>{rollLabel(shot.rolls)}</dd></div>
              <div><dt>Framing</dt><dd>{shot.shot_type}</dd></div>
              <div><dt>Angle</dt><dd>{shot.camera_angle}</dd></div>
              <div><dt>Gerak</dt><dd>{shot.camera_movement}</dd></div>
              <div><dt>Durasi</dt><dd className="mono">{shot.duration_ms / 1000} dtk</dd></div>
            </dl>
            {shot.action && <div className="meta-note"><strong>Aksi & ekspresi</strong><p>{shot.action}</p></div>}
            {shot.visual && <div className="meta-note"><strong>Visual / VFX</strong><p>{shot.visual}</p></div>}
          </div>
        </div>

        <div className="animatic-bars" role="group" aria-label="Progres per shot">
          {shots.map((s, i) => {
            const pct = i < idx ? 100 : i > idx ? 0 : progress * 100;
            return (
              <button key={s.id} className={`seg-bar ${i === idx ? "on" : ""}`} style={{ flexGrow: s.duration_ms }}
                onClick={() => jump(i)} aria-label={`Lompat ke Shot ${i + 1}: ${s.title || "tanpa judul"}`}
                title={`${i + 1}. ${s.title || "Shot"} (${s.duration_ms / 1000} dtk)`}>
                <span className="seg-fill" style={{ width: `${pct}%` }} />
              </button>
            );
          })}
        </div>

        <footer className="animatic-controls">
          <button className="btn" disabled={idx === 0} onClick={() => jump(idx - 1)}>Sebelumnya</button>
          <button ref={playBtn} className="btn primary" onClick={togglePlay}>{playing ? "Jeda" : elapsed >= total ? "Putar ulang" : "Putar"}</button>
          <button className="btn" onClick={() => { setElapsed(0); setPlaying(true); }}>Dari awal</button>
          <button className="btn" disabled={idx === shots.length - 1} onClick={() => jump(idx + 1)}>Berikutnya</button>
          <label className="check">
            <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
            <span>Ulang otomatis</span>
          </label>
        </footer>
      </div>
    </div>
  );
}
