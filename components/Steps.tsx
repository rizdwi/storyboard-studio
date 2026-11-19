"use client";
import { useMemo, useState } from "react";
import { ART_STYLES, STORY_STYLES, activeArt, activePrefix, allArtStyles, buildPrompt, newShot, paletteFromAccent, retime, rollLabel, tc, uid } from "@/lib/data";
import { parseTable } from "@/lib/parse";
import { readFile } from "@/lib/store";
import type { Ctx } from "./Studio";
import Frame from "./Frame";

function Next({ label, to, go }: { label: string; to: number; go: (n: number) => void }) {
  return <div className="step-foot"><button className="btn primary" onClick={() => go(to)}>{label}</button></div>;
}

function AiHint({ openSettings }: { openSettings: () => void }) {
  return (
    <p className="hint">
      AI belum diatur, jadi tombol generate tidak aktif. Semua fitur lain tetap jalan tanpa internet.{" "}
      <button className="link" onClick={openSettings}>Buka Pengaturan AI</button>
    </p>
  );
}

export function StepTheme({ p, set, go }: Ctx) {
  const style = STORY_STYLES.find((s) => s.id === p.story_style.preset_id);
  return (
    <section className="page">
      <h1>Tema & premis</h1>
      <p className="lede">Mulai dari satu kalimat ide. Semua langkah berikutnya bisa diubah kapan saja.</p>
      <label className="field">
        <span>Judul proyek</span>
        <input value={p.title} onChange={(e) => set((x) => ({ ...x, title: e.target.value }))} placeholder="Judul video" />
      </label>
      <label className="field">
        <span>Premis cerita</span>
        <textarea rows={5} value={p.premise} onChange={(e) => set((x) => ({ ...x, premise: e.target.value }))}
          placeholder="Siapa tokohnya, apa yang terjadi, dan apa yang membuat penonton bertahan sampai detik terakhir?" />
      </label>
      <label className="field narrow">
        <span>Target durasi (detik)</span>
        <input type="number" min={5} max={180} value={p.target_secs}
          onChange={(e) => set((x) => ({ ...x, target_secs: Math.max(5, Math.min(180, +e.target.value || 0)) }))} />
        {style && <small>Gaya {style.name} biasanya {style.range}.</small>}
      </label>
      <Next label="Lanjut: pilih gaya cerita" to={2} go={go} />
    </section>
  );
}

export function StepStyle({ p, set, go }: Ctx) {
  const preset = STORY_STYLES.find((s) => s.id === p.story_style.preset_id) ?? STORY_STYLES[0];
  return (
    <section className="page">
      <h1>Gaya cerita</h1>
      <p className="lede">Gaya menentukan struktur beat dan aturan yang dikirim ke model saat generate.</p>
      <div className="style-list" role="radiogroup" aria-label="Preset gaya cerita">
        {STORY_STYLES.map((s) => (
          <label key={s.id} className={`style-row ${s.id === preset.id ? "on" : ""}`}>
            <input type="radio" name="story" checked={s.id === preset.id}
              onChange={() => set((x) => ({ ...x, story_style: { preset_id: s.id, rules: s.rules } }))} />
            <span className="style-name">{s.name}</span>
            <span className="mono dim">{s.range}</span>
            <span className="beats">{s.beats.join(" · ")}</span>
          </label>
        ))}
      </div>
      <label className="field">
        <span>Aturan untuk model</span>
        <textarea rows={6} value={p.story_style.rules}
          onChange={(e) => set((x) => ({ ...x, story_style: { ...x.story_style, rules: e.target.value } }))} />
        {p.story_style.rules !== preset.rules && (
          <button className="link" onClick={() => set((x) => ({ ...x, story_style: { ...x.story_style, rules: preset.rules } }))}>
            Kembalikan aturan bawaan {preset.name}
          </button>
        )}
      </label>
      <Next label="Lanjut: script" to={3} go={go} />
    </section>
  );
}

export function StepScript(ctx: Ctx) {
  const { p, set, go, hasText, aiText, openSettings } = ctx;
  const [tab, setTab] = useState<"script" | "table">("script");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const generate = async () => {
    if (p.script.trim() && !confirm("Script yang ada akan diganti hasil generate. Lanjutkan?")) return;
    const st = STORY_STYLES.find((s) => s.id === p.story_style.preset_id)!;
    setBusy(true); setErr("");
    const r = await aiText(
      [
        `Judul: ${p.title}`, `Premis: ${p.premise || "(bebas, buat sendiri)"}`, `Target durasi: ${p.target_secs} detik`,
        `Gaya cerita: ${st.name} (${st.range})`, `Struktur beat: ${st.beats.join(" > ")}`, `Aturan: ${p.story_style.rules}`,
        p.character.name && `Karakter utama: ${p.character.name}. ${p.character.description}`,
        `Format: untuk setiap beat tulis heading "[BEAT: nama] (perkiraan detik)", lalu deskripsi visual singkat, aksi karakter, dan baris VO/dialog bila ada.`,
      ].filter(Boolean).join("\n"),
      "Kamu penulis naskah video pendek vertikal 9:16 untuk TikTok, Reels, dan Shorts. Tulis dalam Bahasa Indonesia yang natural. Keluarkan hanya naskah, tanpa pengantar atau penutup.",
    );
    setBusy(false);
    if (r.ok && r.text?.trim()) set((x) => ({ ...x, script: r.text!.trim() }));
    else setErr(r.error ? `${r.status ? `HTTP ${r.status}: ` : ""}${r.error}` : "Model mengembalikan teks kosong. Coba lagi atau ganti model.");
  };

  return (
    <section className="page wide">
      <h1>Script</h1>
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "script"} onClick={() => setTab("script")}>Tulis script</button>
        <button role="tab" aria-selected={tab === "table"} onClick={() => setTab("table")}>Impor tabel shot</button>
      </div>

      {tab === "script" ? (
        <div role="tabpanel">
          <div className="row">
            <button className="btn primary" disabled={!hasText || busy} onClick={generate}>{busy ? "Menulis script…" : "Generate script dengan AI"}</button>
            <label className="btn">Unggah .txt / .md
              <input type="file" accept=".txt,.md,text/plain,text/markdown" hidden
                onChange={async (e) => { const f = e.target.files?.[0]; if (f) { const t = await readFile(f, "text"); set((x) => ({ ...x, script: t })); } e.target.value = ""; }} />
            </label>
            <span className="dim">{p.script.trim() ? `${p.script.trim().split(/\s+/).length} kata` : ""}</span>
          </div>
          {!hasText && <AiHint openSettings={openSettings} />}
          {err && <p className="error" role="alert">{err}</p>}
          <textarea className="script" value={p.script} aria-label="Script" disabled={busy}
            onChange={(e) => set((x) => ({ ...x, script: e.target.value }))}
            placeholder={"Tulis atau tempel script di sini.\n\n[BEAT: Pemicu kecil] (0–5 dtk)\nRaka menjatuhkan kunci di tangga…"} />
          <Next label="Lanjut: karakter & gaya visual" to={4} go={go} />
        </div>
      ) : (
        <TableImport {...ctx} />
      )}
    </section>
  );
}

function TableImport({ set, go }: Ctx) {
  const [raw, setRaw] = useState("");
  const shots = useMemo(() => parseTable(raw), [raw]);
  const total = shots.reduce((a, s) => a + s.duration_ms, 0);
  const apply = (mode: "replace" | "append") => {
    set((x) => ({ ...x, shots: retime(mode === "replace" ? shots : [...x.shots, ...shots]) }));
    go(5);
  };
  return (
    <div role="tabpanel">
      <p className="lede">Tempel tabel Markdown, CSV, atau TSV. Baris pertama dibaca sebagai judul kolom. Semua diproses di perangkat ini, tanpa AI.</p>
      <div className="row">
        <label className="btn">Unggah .md / .csv / .tsv
          <input type="file" accept=".md,.csv,.tsv,.txt" hidden
            onChange={async (e) => { const f = e.target.files?.[0]; if (f) setRaw(await readFile(f, "text")); e.target.value = ""; }} />
        </label>
        <span className="dim">Kolom yang dikenali: Waktu, Durasi, Roll, Judul, Beat, Shot/Framing, Angle, Movement, Kamera, Aksi, Visual, Audio/VO.</span>
      </div>
      <textarea className="script mono" rows={8} value={raw} onChange={(e) => setRaw(e.target.value)} aria-label="Tabel shot"
        placeholder={"| Waktu | Roll | Judul | Kamera | Aksi | Audio |\n|---|---|---|---|---|---|\n| 00:00 – 00:04 | A-Roll | Bangun | MCU eye level push-in | Raka membuka mata | VO: Hari ini beda. |"} />
      {raw.trim() && !shots.length && <p className="error" role="alert">Tidak ada baris shot yang terbaca. Pastikan ada baris judul kolom dan minimal satu baris data.</p>}
      {shots.length > 0 && (
        <>
          <p className="ok">{shots.length} shot terbaca · total <span className="mono">{tc(total)}</span></p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Waktu</th><th>Roll</th><th>Shot</th><th>Angle</th><th>Movement</th><th>Judul</th></tr></thead>
              <tbody>
                {shots.map((s, i) => (
                  <tr key={s.id}>
                    <td>{i + 1}</td><td className="mono">{tc(s.start_ms)}–{tc(s.start_ms + s.duration_ms)}</td><td>{rollLabel(s.rolls)}</td>
                    <td>{s.shot_type}</td><td>{s.camera_angle}</td><td>{s.camera_movement}</td><td>{s.title}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button className="btn primary" onClick={() => apply("replace")}>Ganti semua shot di board</button>
            <button className="btn" onClick={() => apply("append")}>Tambahkan ke akhir board</button>
          </div>
        </>
      )}
    </div>
  );
}

export function StepCharacter({ p, set, go }: Ctx) {
  const [draft, setDraft] = useState<{ name: string; accent: string; prefix: string } | null>(null);
  const art = activeArt(p);
  const prefix = activePrefix(p);
  const sample = p.shots[0] ?? newShot({ action: "contoh aksi karakter" });

  const setPrefix = (v: string) => set((x) => art.is_custom
    ? { ...x, custom_art_styles: x.custom_art_styles.map((c) => (c.id === art.id ? { ...c, prompt_prefix: v } : c)) }
    : { ...x, art_prefix_overrides: { ...x.art_prefix_overrides, [art.id]: v } });

  const patchCustom = (patch: Partial<typeof art>) =>
    set((x) => ({ ...x, custom_art_styles: x.custom_art_styles.map((c) => (c.id === art.id ? { ...c, ...patch } : c)) }));

  return (
    <section className="page wide">
      <h1>Karakter & gaya visual</h1>
      <p className="lede">Deskripsi karakter dan prefix gaya dikunci ke setiap prompt gambar, supaya semua shot konsisten.</p>
      <div className="two">
        <label className="field">
          <span>Nama karakter</span>
          <input value={p.character.name} placeholder="Nama tokoh utama" onChange={(e) => set((x) => ({ ...x, character: { ...x.character, name: e.target.value } }))} />
        </label>
        <label className="field">
          <span>Ciri fisik & kostum</span>
          <textarea rows={3} value={p.character.description} placeholder="Usia, rambut, pakaian, ciri khas yang harus selalu terlihat"
            onChange={(e) => set((x) => ({ ...x, character: { ...x.character, description: e.target.value } }))} />
        </label>
      </div>

      <h2>Gaya visual</h2>
      <div className="art-grid" role="radiogroup" aria-label="Gaya visual">
        {allArtStyles(p).map((a) => (
          <label key={a.id} className={`art ${a.id === art.id ? "on" : ""}`}>
            <input type="radio" name="art" className="sr" checked={a.id === art.id} onChange={() => set((x) => ({ ...x, active_art_style_id: a.id }))} />
            <span className="art-frame"><Frame shot={newShot()} pal={a.palette} guides={false} /></span>
            <span>{a.name}</span>
            {a.is_custom && <small className="dim">Kustom</small>}
          </label>
        ))}
        <button className="art add" onClick={() => setDraft({ name: "", accent: "#e9a23b", prefix: "" })}>+ Tambah gaya kustom</button>
      </div>

      {draft && (
        <div className="panel">
          <h3>Gaya kustom baru</h3>
          <div className="two">
            <label className="field"><span>Nama gaya</span><input autoFocus value={draft.name} placeholder="mis. Cyberpunk Watercolor" onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
            <label className="field narrow"><span>Warna aksen pratinjau</span><input type="color" value={draft.accent} onChange={(e) => setDraft({ ...draft, accent: e.target.value })} /></label>
          </div>
          <label className="field"><span>Prefix prompt</span><textarea rows={3} value={draft.prefix} placeholder="Gaya, medium, pencahayaan, palet warna, tekstur" onChange={(e) => setDraft({ ...draft, prefix: e.target.value })} /></label>
          <div className="row">
            <button className="btn primary" disabled={!draft.name.trim()} onClick={() => {
              const id = `custom-${uid()}`;
              set((x) => ({ ...x, active_art_style_id: id, custom_art_styles: [...x.custom_art_styles, { id, name: draft.name.trim(), prompt_prefix: draft.prefix.trim(), palette: paletteFromAccent(draft.accent), is_custom: true }] }));
              setDraft(null);
            }}>Simpan gaya</button>
            <button className="btn ghost" onClick={() => setDraft(null)}>Batal</button>
          </div>
        </div>
      )}

      {art.is_custom && (
        <div className="row">
          <label className="field inline"><span>Nama</span><input value={art.name} onChange={(e) => patchCustom({ name: e.target.value })} /></label>
          <label className="field inline"><span>Aksen</span><input type="color" value={art.palette[3]} onChange={(e) => patchCustom({ palette: paletteFromAccent(e.target.value) })} /></label>
          <button className="btn ghost danger" onClick={() => confirm(`Hapus gaya "${art.name}"?`) &&
            set((x) => ({ ...x, active_art_style_id: ART_STYLES[0].id, custom_art_styles: x.custom_art_styles.filter((c) => c.id !== art.id) }))}>Hapus gaya ini</button>
        </div>
      )}

      <label className="field">
        <span>Prefix prompt aktif · {art.name}</span>
        <textarea rows={3} value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        {!art.is_custom && p.art_prefix_overrides[art.id] !== undefined && (
          <button className="link" onClick={() => set((x) => { const o = { ...x.art_prefix_overrides }; delete o[art.id]; return { ...x, art_prefix_overrides: o }; })}>
            Kembalikan prefix bawaan
          </button>
        )}
      </label>
      <div className="field">
        <span>Contoh hasil Salin Prompt{p.shots[0] ? " (shot 1)" : ""}</span>
        <output className="prompt-preview">{buildPrompt(p, sample)}</output>
      </div>
      <Next label="Lanjut: board & timeline" to={5} go={go} />
    </section>
  );
}
