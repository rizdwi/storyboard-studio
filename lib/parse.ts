// Parser tabel shot lokal (Markdown pipa, CSV, TSV) + ekspor CSV/Markdown. Tanpa AI, tanpa jaringan.
import { ANGLES, MOVEMENTS, newShot, retime, rollLabel, tc } from "./data.ts";
import type { Project, Roll, Shot, ShotType } from "./data.ts";

const clampDur = (ms: number) => Math.min(30000, Math.max(500, Math.round(ms)));

export function detectRolls(text: string): Roll[] {
  const t = text.toUpperCase();
  let found = [...t.matchAll(/\b([ABX])\s*-?\s*ROLL\b/g)].map((m) => m[1]);
  if (!found.length) found = [...t.matchAll(/(?:^|[\s+/&,])([ABX])(?=$|[\s+/&,])/g)].map((m) => m[1]);
  const set = new Set(found);
  const out = (["A", "B", "X"] as Roll[]).filter((r) => set.has(r));
  return out.length ? out : ["A"];
}

const SHOT_RULES: [ShotType, RegExp][] = [
  ["TwoShot", /\b(two|2)[\s-]?shot\b/i],
  ["ECU", /\b(ecu|extreme\s*close)/i],
  ["MCU", /\b(mcu|medium\s*close)/i],
  ["CU", /\b(cu|close[\s-]?up)\b/i],
  ["EWS", /\b(ews|els|extreme\s*(wide|long))/i],
  ["MWS", /\b(mws|mls|medium\s*(wide|long|full)|cowboy)/i],
  ["WS", /\b(ws|ls|wide|long\s*shot|establishing)\b/i],
  ["FS", /\b(fs|full[\s-]?shot|full\s*body)\b/i],
  ["MS", /\b(ms|medium|mid[\s-]?shot)\b/i],
  ["Insert", /\b(insert|detail|cutaway)\b/i],
];
export const detectShotType = (text: string): ShotType | undefined => SHOT_RULES.find(([, re]) => re.test(text))?.[0];

const ANGLE_RULES: [string, RegExp][] = [
  [ANGLES[4], /worm/i],
  [ANGLES[3], /bird|overhead|top[\s-]?down|90°/i],
  [ANGLES[6], /\bots\b|over[\s-]the[\s-]shoulder/i],
  [ANGLES[7], /\bpov\b|point[\s-]of[\s-]view/i],
  [ANGLES[5], /dutch|canted/i],
  [ANGLES[1], /low[\s-]?angle|heroic/i],
  [ANGLES[2], /high[\s-]?angle/i],
  [ANGLES[9], /three[\s-]quarter|3\/4/i],
  [ANGLES[8], /profile|side[\s-]?view|samping/i],
  [ANGLES[0], /eye[\s-]?level|sejajar/i],
];
export const detectAngle = (text: string) => ANGLE_RULES.find(([, re]) => re.test(text))?.[0];

const MOVE_RULES: [string, RegExp][] = [
  [MOVEMENTS[3], /dolly[\s-]?zoom|vertigo/i],
  [MOVEMENTS[14], /snorri/i],
  [MOVEMENTS[6], /whip/i],
  [MOVEMENTS[1], /push[\s-]?in|dolly[\s-]?in|zoom[\s-]?in/i],
  [MOVEMENTS[2], /pull[\s-]?(out|back)|dolly[\s-]?out|zoom[\s-]?out/i],
  [MOVEMENTS[4], /pan[\s-]?(left|kiri)/i],
  [MOVEMENTS[5], /pan[\s-]?(right|kanan)|\bpan\b/i],
  [MOVEMENTS[7], /tilt[\s-]?(up|naik|atas)|\btilt\b/i],
  [MOVEMENTS[8], /tilt[\s-]?(down|turun|bawah)/i],
  [MOVEMENTS[10], /(crane|jib|pedestal)[\s-]?(up|naik)/i],
  [MOVEMENTS[11], /(crane|jib|pedestal)[\s-]?(down|turun)|\bcrane\b/i],
  [MOVEMENTS[13], /orbit|360|\barc\b/i],
  [MOVEMENTS[9], /track|follow|ikut/i],
  [MOVEMENTS[12], /handheld|shaky|goyang/i],
  [MOVEMENTS[0], /static|statis|still|locked|diam|tripod/i],
];
export const detectMovement = (text: string) => {
  // "tilt down" harus menang dari aturan umum "\btilt\b"
  if (/tilt[\s-]?(down|turun|bawah)/i.test(text)) return MOVEMENTS[8];
  return MOVE_RULES.find(([, re]) => re.test(text))?.[0];
};

/** "00:04 – 00:08", "0:04-0:08.5", "4s-8s" -> [startMs, endMs] */
export function parseRange(text: string): [number, number] | undefined {
  const codes = [...text.matchAll(/(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?/g)].map(
    (m) => (+m[1] * 60 + +m[2]) * 1000 + (m[3] ? +m[3].padEnd(3, "0") : 0),
  );
  if (codes.length >= 2) return [codes[0], codes[1]];
  const secs = text.match(/(\d+(?:[.,]\d+)?)\s*s?\s*[-–—]\s*(\d+(?:[.,]\d+)?)\s*s?/i);
  if (secs) return [parseFloat(secs[1].replace(",", ".")) * 1000, parseFloat(secs[2].replace(",", ".")) * 1000];
}

export const parseSeconds = (text: string) => {
  const m = text.match(/(\d+(?:[.,]\d+)?)/);
  return m ? parseFloat(m[1].replace(",", ".")) * 1000 : undefined;
};

/** Pemecah CSV/TSV sesuai RFC 4180 (kutip ganda, koma/baris baru di dalam kutip). */
export function splitDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === "") q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function splitMarkdown(text: string): string[][] {
  return text.split(/\r?\n/)
    .filter((l) => l.includes("|") && !/^\s*\|?\s*:?-{2,}/.test(l))
    .map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim().replace(/<br\s*\/?>/gi, "\n")));
}

const FIELDS: [keyof Shot | "range" | "camera" | "no", RegExp][] = [
  ["no", /^(no|#|nomor|shot\s*#|scene\s*#)$/i],
  ["range", /waktu|time|timecode|tc|rentang/i],
  ["duration_ms", /durasi|duration|dur|detik|sec/i],
  ["visual", /visual|vfx|overlay|grafis/i],
  ["rolls", /roll|jalur|track|lane/i],
  ["title", /judul|title|nama|scene|adegan$/i],
  ["beat", /beat/i],
  ["shot_type", /framing|ukuran|shot\s*size|shot\s*type|^shot$|tipe\s*shot/i],
  ["camera_angle", /angle|sudut/i],
  ["camera_movement", /movement|gerak/i],
  ["camera", /kamera|camera|cam/i],
  ["action", /aksi|action|ekspresi|deskripsi|description/i],
  ["audio", /audio|vo\b|voice|dialog|narasi|sfx|suara|musik/i],
];

export function parseTable(input: string): Shot[] {
  const text = input.trim();
  if (!text) return [];
  const firstLine = text.split(/\r?\n/)[0];
  const rows = firstLine.includes("|") ? splitMarkdown(text) : splitDelimited(text, firstLine.includes("\t") ? "\t" : firstLine.includes(";") && !firstLine.includes(",") ? ";" : ",");
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  const map = header.map((h) => FIELDS.find(([, re]) => re.test(h))?.[0]);
  const has = (f: string) => map.includes(f as never);

  const shots = rows.slice(1).map((cells, i) => {
    const get = (f: string) => cells[map.indexOf(f as never)]?.trim() ?? "";
    const camera = get("camera");
    const joined = cells.join(" ");
    const camSrc = (f: string) => (has(f) ? get(f) : "") || camera || joined;
    const range = has("range") ? parseRange(get("range")) : undefined;
    const dur = (has("duration_ms") && parseSeconds(get("duration_ms"))) || (range ? range[1] - range[0] : 3000);
    return newShot({
      title: get("title") || `Shot ${i + 1}`,
      beat: get("beat"),
      duration_ms: clampDur(dur),
      rolls: detectRolls(has("rolls") ? get("rolls") : joined),
      shot_type: detectShotType(camSrc("shot_type")) ?? "MS",
      camera_angle: detectAngle(camSrc("camera_angle")) ?? ANGLES[0],
      camera_movement: detectMovement(camSrc("camera_movement")) ?? MOVEMENTS[0],
      action: get("action") || (map.every((m) => !m) ? joined : ""),
      visual: get("visual"),
      audio: get("audio"),
    });
  });
  return retime(shots);
}

/** Normalisasi hasil JSON dari model AI ke Shot, memakai detektor yang sama dengan parser tabel. */
export function shotsFromAi(items: unknown[]): Shot[] {
  return retime(items.filter((x): x is Record<string, unknown> => !!x && typeof x === "object").map((o, i) => {
    const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : Array.isArray(o[k]) ? (o[k] as string[]).join("+") : typeof o[k] === "number" ? String(o[k]) : "");
    return newShot({
      title: s("title") || `Shot ${i + 1}`,
      beat: s("beat"),
      duration_ms: clampDur((parseFloat(s("duration_s")) || parseFloat(s("duration")) || 3) * 1000),
      rolls: detectRolls(s("rolls") || s("roll")),
      shot_type: detectShotType(s("shot_type")) ?? "MS",
      camera_angle: detectAngle(s("camera_angle")) ?? ANGLES[0],
      camera_movement: detectMovement(s("camera_movement")) ?? MOVEMENTS[0],
      action: s("action"), visual: s("visual"), audio: s("audio"),
    });
  }));
}

const CSV_HEAD = ["No", "Waktu", "Durasi", "Roll", "Judul", "Beat", "Shot", "Angle", "Movement", "Aksi", "Visual", "Audio"];
const row = (s: Shot, i: number) => [
  String(i + 1), `${tc(s.start_ms)} – ${tc(s.start_ms + s.duration_ms)}`, `${s.duration_ms / 1000}s`, rollLabel(s.rolls),
  s.title, s.beat, s.shot_type === "TwoShot" ? "Two-Shot" : s.shot_type, s.camera_angle, s.camera_movement, s.action, s.visual, s.audio,
];

export const toCsv = (shots: Shot[]) =>
  [CSV_HEAD, ...shots.map(row)].map((r) => r.map((c) => (/[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\r\n");

export function toMarkdown(p: Project) {
  const esc = (c: string) => c.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
  const total = p.shots.reduce((a, s) => a + s.duration_ms, 0);
  return [
    `# ${p.title}`, "", p.premise ? `> ${p.premise}` : null, p.premise ? "" : null,
    `Durasi total: ${tc(total)} · ${p.shots.length} shot`, "",
    p.character.name ? `**Karakter:** ${p.character.name}. ${p.character.description}` : null, p.character.name ? "" : null,
    `| ${CSV_HEAD.join(" | ")} |`, `|${CSV_HEAD.map(() => " --- ").join("|")}|`,
    ...p.shots.map((s, i) => `| ${row(s, i).map(esc).join(" | ")} |`),
    p.script ? "\n## Script\n\n" + p.script : null,
  ].filter((l): l is string => l !== null).join("\n");
}

