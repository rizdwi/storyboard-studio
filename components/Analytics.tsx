"use client";
import { useState } from "react";
import type { Project } from "@/lib/data";

const DAYS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat"];

/** Bagian tanggal (Y-M-D) dalam zona Asia/Jakarta. */
function wibParts(ts: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(ts));
  const get = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day") };
}

function wibDayIndex(ts: number) {
  const { y, m, d } = wibParts(ts);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Minggu .. 6=Sabtu
}

function wibKey(ts: number) {
  const { y, m, d } = wibParts(ts);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Klip video selesai per hari Senin–Jumat minggu berjalan (WIB).
    Sumber: jumlah shot video_status=done per proyek, dikelompokkan memakai
    tanggal terakhir proyek diubah (updated_at) — proyek tidak menyimpan
    stempel waktu selesai per klip, jadi ini proksi yang dipakai. */
function weeklyDone(projects: Project[]): number[] {
  const counts = [0, 0, 0, 0, 0];
  const now = Date.now();
  const todayIdx = wibDayIndex(now); // 0=Minggu..6=Sabtu
  const mondayOffset = (todayIdx + 6) % 7; // hari sejak Senin
  const { y, m, d } = wibParts(now);
  const monday = Date.UTC(y, m - 1, d) - mondayOffset * 86400000;
  const keys = [0, 1, 2, 3, 4].map((i) => {
    const t = new Date(monday + i * 86400000);
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
  });
  for (const p of projects) {
    const done = p.shots.filter((s) => s.video_status === "done").length;
    if (!done) continue;
    const k = keys.indexOf(wibKey(p.updated_at));
    if (k >= 0) counts[k] += done;
  }
  return counts;
}

export default function Analytics({ projects }: { projects: Project[] }) {
  const [ytNote, setYtNote] = useState("");
  const [igNote, setIgNote] = useState("");
  const bars = weeklyDone(projects);
  const max = Math.max(...bars, 0);

  return (
    <div className="page wide">
      <p className="eyebrow">Analitik</p>
      <h1>YouTube &amp; Instagram</h1>
      <p className="lede">Performa video yang sudah dipublikasikan, per channel. Data diambil dari akun yang terhubung — belum ada angka palsu di sini.</p>

      <div className="chan">
        <div className="chan-card">
          <div className="chan-head">
            <span className="chan-ico yt" aria-hidden="true">▶</span>
            <div><div className="t">YouTube</div><div className="s">Teras Darto · @rizkidwi7823</div></div>
            <span style={{ flex: 1 }} /><span className="pill warn">Belum terhubung</span>
          </div>
          <div className="empty-box">Hubungkan channel YouTube untuk melihat views, CTR, dan retensi per video.<br />Data ditarik dari YouTube Studio, bukan dari aplikasi ini.</div>
          <div className="row">
            <button className="btn primary sm" onClick={() => setYtNote("Penghubungan YouTube belum tersedia. Channel Teras Darto (@rizkidwi7823) akan dihubungkan nanti — views, CTR, dan retensi baru tampil setelah itu.")}>Hubungkan YouTube</button>
          </div>
          {ytNote && <p className="hint" style={{ margin: 0 }} role="status">{ytNote}</p>}
        </div>

        <div className="chan-card">
          <div className="chan-head">
            <span className="chan-ico ig" aria-hidden="true">◎</span>
            <div><div className="t">Instagram</div><div className="s">@insanulmuslim · YIMI</div></div>
            <span style={{ flex: 1 }} /><span className="pill ok">Terhubung</span>
          </div>
          <div className="kpis">
            <div className="kpi"><span className="n">—</span><span className="l">Followers</span></div>
            <div className="kpi"><span className="n">—</span><span className="l">Jangkauan 7 hari</span></div>
            <div className="kpi"><span className="n">—</span><span className="l">Reels terbit 7 hari</span></div>
          </div>
          <div className="empty-box">Angka tampil setelah sinkronisasi pertama. Target: 10.000 followers.</div>
          <div className="row">
            <button className="btn sm" onClick={() => setIgNote("Belum ada sinkronisasi — angka akan tampil setelah sinkronisasi pertama.")}>Sinkronkan sekarang</button>
          </div>
          {igNote && <p className="hint" style={{ margin: 0 }} role="status">{igNote}</p>}
        </div>
      </div>

      <h2>Video terbaik 7 hari terakhir</h2>
      <div className="panel">
        <div className="empty-box">Belum ada data tayang. Setelah satu video dipublikasikan dan akun terhubung, daftar ini terisi otomatis — diurutkan dari views tertinggi.</div>
      </div>

      <h2>Produksi vs tayang</h2>
      <div className="panel">
        <div className="bars">
          {DAYS.map((d, i) => (
            <div className="bar-row" key={d}>
              <span className="d">{d}</span>
              <div className="track"><div className="fill" style={{ width: `${max ? Math.round((bars[i] / max) * 100) : 0}%` }} /></div>
              <span className="v">{bars[i]}</span>
            </div>
          ))}
        </div>
        <div className="hint">Batang dihitung dari klip video yang selesai dibuat di Studio per hari (lokal + cloud), memakai tanggal terakhir tiap proyek diubah sebagai hari selesai. Nol bila tidak ada — bukan angka contoh.</div>
      </div>
    </div>
  );
}
