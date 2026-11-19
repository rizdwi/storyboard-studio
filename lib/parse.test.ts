// Jalankan: npm test  (node menjalankan TypeScript langsung lewat type stripping)
import assert from "node:assert/strict";
import { parseTable, toCsv, detectMovement, parseRange } from "./parse.ts";

const md = `
| No | Waktu | Roll | Judul | Kamera | Aksi & Ekspresi | Visual/B-Roll/VFX | Audio/VO |
|---|---|---|---|---|---|---|---|
| 1 | 00:00 – 00:04 | A-Roll | Bangun | MCU, eye level, slow push-in | Raka membuka mata | | VO: "Hari ini beda." |
| 2 | 00:04 – 00:08 | A-Roll + X-Roll | Jam | ECU low angle static | Jarum jam berhenti | glitch overlay | SFX: tik |
| 3 | 00:08 – 00:09.5 | B-Roll | Jalan | Wide shot, dutch angle, tilt down | Kota sepi | | |
`;
const a = parseTable(md);
assert.equal(a.length, 3);
assert.deepEqual(a.map((s) => s.duration_ms), [4000, 4000, 1500]);
assert.deepEqual(a.map((s) => s.start_ms), [0, 4000, 8000]);
assert.deepEqual(a[1].rolls, ["A", "X"]);
assert.deepEqual(a.map((s) => s.shot_type), ["MCU", "ECU", "WS"]);
assert.deepEqual(a.map((s) => s.camera_angle), ["Eye-Level", "Low Angle (Heroic)", "Dutch Angle"]);
assert.deepEqual(a.map((s) => s.camera_movement), ["Slow Push-In", "Static", "Tilt Down"]);
assert.equal(a[1].visual, "glitch overlay");
assert.equal(a[0].audio, 'VO: "Hari ini beda."');

// Round-trip CSV: ekspor lalu impor ulang harus menghasilkan data shot yang sama.
const strip = (xs: typeof a) => xs.map(({ id, image, ...rest }) => rest);
const b = parseTable(toCsv(a));
assert.deepEqual(strip(b), strip(a));

// TSV + koma di dalam sel
const tsv = "Judul\tDurasi\tShot\tAngle\tMovement\tRoll\nA, B\t2.5s\tTwo-Shot\tOTS\tOrbit 360\tA+B+X";
const c = parseTable(tsv)[0];
assert.equal(c.title, "A, B");
assert.equal(c.duration_ms, 2500);
assert.equal(c.shot_type, "TwoShot");
assert.equal(c.camera_angle, "Over-the-Shoulder (OTS)");
assert.equal(c.camera_movement, "Orbit 360°");
assert.deepEqual(c.rolls, ["A", "B", "X"]);

assert.equal(detectMovement("whip pan to the right"), "Whip Pan");
assert.equal(detectMovement("dolly zoom"), "Dolly Zoom (Vertigo)");
assert.deepEqual(parseRange("4s - 8s"), [4000, 8000]);

console.log("parse.test.ts: semua lulus");
