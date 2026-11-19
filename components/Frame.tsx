"use client";
// Pratinjau 9:16 prosedural: siluet berubah sesuai framing & angle, plus panduan safe-zone.
import type { ReactNode } from "react";
import type { Shot } from "@/lib/data";

type Pal = [string, string, string, string];

const BODY = "M-4 13L4 13L4 15C10 15.5 14 17 14.5 22L15 48L10 50L10 98L2 98L1 55L-1 55L-2 98L-10 98L-10 50L-15 48L-14.5 22C-14 17-10 15.5-4 15Z";

// [skala, posisi y puncak kepala] per framing; satuan figur = 100 tinggi.
const FRAMING: Record<string, [number, number]> = {
  EWS: [0.2, 0], WS: [0.55, 83], FS: [1.2, 22], MWS: [1.85, 24], MS: [2.6, 30],
  MCU: [4, 30], CU: [6.5, 35], ECU: [14, -14], TwoShot: [2.2, 40],
};

function Person({ x, top, s, pal, nose, eyes }: { x: number; top: number; s: number; pal: Pal; nose?: "full" | "half"; eyes?: boolean }) {
  return (
    <g transform={`translate(${x} ${top}) scale(${s})`}>
      <circle cx="0" cy="7" r="6.5" fill={pal[2]} />
      <path d={BODY} fill={pal[2]} />
      {nose && <path d={nose === "full" ? "M6 5L8.6 7.6L6 8.6Z" : "M5.6 5.8L7 7.4L5.6 8Z"} fill={pal[2]} />}
      {eyes && (
        <g fill={pal[0]}>
          <ellipse cx="-2.6" cy="6" rx="1.3" ry="0.7" />
          <ellipse cx="2.6" cy="6" rx="1.3" ry="0.7" />
        </g>
      )}
    </g>
  );
}

export default function Frame({ shot, pal, guides = true }: { shot: Shot; pal: Pal; guides?: boolean }) {
  const a = shot.camera_angle;
  const t = shot.shot_type;
  const horizon = a.startsWith("Low") ? 118 : a.startsWith("High") ? 58 : a.startsWith("Worm") ? 146 : 92;
  const bird = a.startsWith("Bird");
  const ots = a.startsWith("Over");
  const nose = a === "Profile" ? "full" : a.startsWith("Three") ? "half" : undefined;
  const angleScale = a.startsWith("Low") ? 1.06 : a.startsWith("Worm") ? 1.15 : a.startsWith("High") ? 0.9 : 1;
  const xShift = ots ? 10 : a.startsWith("Three") ? -4 : 0;

  let subject: ReactNode;
  if (t === "Insert") {
    subject = (
      <g>
        <rect x="27" y="62" width="36" height="44" rx="4" fill={pal[2]} />
        <rect x="33" y="70" width="24" height="5" rx="1" fill={pal[3]} />
        <path d="M14 140C20 118 34 110 42 108L50 112L44 120L58 118L60 126L36 140Z" fill={pal[2]} opacity="0.75" />
      </g>
    );
  } else if (bird) {
    const k = Math.min(3.2, Math.max(0.5, (FRAMING[t]?.[0] ?? 2.6) / 2));
    const people = t === "TwoShot" ? [32, 58] : [45];
    subject = people.map((x) => (
      <g key={x} transform={`translate(${x} 82) scale(${k})`}>
        <ellipse rx="15" ry="6.5" fill={pal[2]} opacity="0.85" />
        <circle r="6" fill={pal[2]} />
      </g>
    ));
  } else {
    const [s0, top0] = FRAMING[t] ?? FRAMING.MS;
    const s = s0 * angleScale * (ots ? 0.85 : 1);
    // Skala angle ditarik dari bawah frame supaya potongan framing tetap terbaca.
    const top = t === "EWS" ? horizon - 14 : a.startsWith("High") ? top0 + 6 : 160 - (160 - top0) * angleScale;
    subject = t === "TwoShot"
      ? <><Person x={27 + xShift} top={top} s={s} pal={pal} nose={nose} /><Person x={63 + xShift} top={top + 4} s={s * 0.96} pal={pal} /></>
      : <Person x={45 + xShift} top={top} s={s} pal={pal} nose={nose} eyes={t === "ECU"} />;
  }

  return (
    <svg viewBox="0 0 90 160" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g transform={a.startsWith("Dutch") ? "rotate(-12 45 80)" : undefined}>
        <rect x="-60" y="-60" width="210" height="280" fill={pal[0]} />
        {!bird && <rect x="-60" y={horizon} width="210" height="220" fill={pal[1]} opacity="0.55" />}
        {bird && <circle cx="45" cy="82" r="58" fill={pal[1]} opacity="0.35" />}
        {subject}
      </g>
      {ots && (
        <g fill={pal[0]} stroke={pal[2]} strokeOpacity="0.25" strokeWidth="0.6">
          <ellipse cx="6" cy="156" rx="34" ry="44" />
          <circle cx="12" cy="104" r="15" />
        </g>
      )}
      {a === "POV" && (
        <g stroke={pal[3]} strokeWidth="0.8" fill="none">
          <path d="M45 72V77M45 83V88M37 80H42M48 80H53" />
          <circle cx="45" cy="80" r="1.2" />
          <path d="M8 22V14H16M74 14H82V22M82 138V146H74M16 146H8V138" />
        </g>
      )}
      {guides && (
        <g stroke={pal[2]} strokeOpacity="0.4" strokeWidth="0.4" strokeDasharray="1.6 1.6" fill="none">
          <path d="M0 15H90M0 126H90M77 62V126" />
        </g>
      )}
    </svg>
  );
}
