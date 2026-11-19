"use client";
import { useEffect, useRef, useState } from "react";

export default function Progress({
  label,
  detail,
  startedAt,
  percent,
  onCancel,
  compact = false,
}: {
  label: string;
  detail?: string;
  startedAt: number;
  percent?: number;
  onCancel?: () => void;
  compact?: boolean;
}) {
  const [now, setNow] = useState(startedAt);
  const peak = useRef(0);
  const lastStart = useRef(startedAt);

  if (lastStart.current !== startedAt) {
    lastStart.current = startedAt;
    peak.current = 0;
  }

  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [startedAt]);

  const elapsedMs = Math.max(0, now - startedAt);
  const secs = Math.floor(elapsedMs / 1000);
  // Sebelum token mengalir (atau untuk generate gambar), progres naik halus tanpa mentok di 100%.
  const timeCurve = Math.round(6 + 76 * (1 - Math.exp(-elapsedMs / 20000)));
  const raw = percent !== undefined && percent > 0 ? Math.min(96, Math.round(percent)) : timeCurve;
  const pct = Math.min(98, Math.max(peak.current, raw));
  peak.current = pct;

  return (
    <div className={compact ? "prog compact" : "prog"} role="status" aria-live="polite">
      <div className="prog-head">
        <span className="prog-label">
          <strong>{label}</strong>
          {detail && <span className="dim"> · {detail}</span>}
        </span>
        <span className="prog-meta mono">
          {pct}% · {secs} dtk
        </span>
        {onCancel && !compact && (
          <button type="button" className="btn ghost sm danger" onClick={onCancel}>Batal</button>
        )}
      </div>
      <div className="prog-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="prog-fill" style={{ width: `${pct}%` }} />
      </div>
      {onCancel && compact && (
        <button type="button" className="btn sm prog-cancel" onClick={onCancel}>Batal</button>
      )}
    </div>
  );
}
