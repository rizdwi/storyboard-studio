"use client";
import { useEffect, useState } from "react";
import { newProfile, PROVIDER_KINDS } from "@/lib/data";
import type { ProviderKind, ProviderProfile } from "@/lib/data";
import { ai, getKey, keyHint, setKey } from "@/lib/store";
import type { AiResult, Settings as S } from "@/lib/store";

export default function Settings({ settings, update, onClose }: { settings: S; update: (fn: (s: S) => S) => void; onClose: () => void }) {
  const [selectedId, setSelectedId] = useState(settings.textProfileId || settings.profiles[0]?.id || "");
  const [keyDraft, setKeyDraft] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testRes, setTestRes] = useState<AiResult | null>(null);

  const active = settings.profiles.find((p) => p.id === selectedId) ?? settings.profiles[0];

  useEffect(() => {
    if (active) {
      setSelectedId(active.id);
      setKeyDraft(getKey(active.id));
      setShowKey(false);
      setTestRes(null);
    }
  }, [active?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const patchProfile = (id: string, patch: Partial<ProviderProfile>) =>
    update((s) => ({ ...s, profiles: s.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));

  const addProfile = () => {
    const created = newProfile("OpenAi");
    update((s) => ({ ...s, profiles: [...s.profiles, created] }));
    setSelectedId(created.id);
  };

  const removeProfile = (p: ProviderProfile) => {
    if (!confirm(`Hapus profil "${p.name}" beserta API key yang tersimpan?`)) return;
    setKey(p.id, "");
    update((s) => {
      const rest = s.profiles.filter((x) => x.id !== p.id);
      return {
        ...s,
        profiles: rest,
        textProfileId: s.textProfileId === p.id ? "" : s.textProfileId,
        imageProfileId: s.imageProfileId === p.id ? "" : s.imageProfileId,
      };
    });
  };

  const changeKind = (p: ProviderProfile, nextKind: ProviderKind) => {
    const prevMeta = PROVIDER_KINDS.find((k) => k.id === p.kind)!;
    const nextMeta = PROVIDER_KINDS.find((k) => k.id === nextKind)!;
    const keepName = p.name && p.name !== prevMeta.label;
    const keepUrl = p.base_url && p.base_url !== prevMeta.base_url;
    patchProfile(p.id, {
      kind: nextKind,
      name: keepName ? p.name : nextMeta.label,
      base_url: keepUrl ? p.base_url : nextMeta.base_url,
      api_version: nextKind === "Anthropic" ? (p.api_version || "2023-06-01") : p.api_version,
    });
  };

  const runTest = async () => {
    if (!active) return;
    setTesting(true); setTestRes(null);
    const res = await ai(active, "test");
    setTesting(false); setTestRes(res);
  };

  const kindMeta = active ? PROVIDER_KINDS.find((k) => k.id === active.kind)! : null;
  const savedHint = active ? keyHint(active.id) : "";

  return (
    <div className="backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="modal-head">
          <div>
            <h2 id="settings-title">Pengaturan AI (BYOK)</h2>
            <p className="dim">API key disimpan hanya di perangkat ini dan tidak pernah ikut dalam file proyek atau ekspor.</p>
          </div>
          <button className="btn ghost" onClick={onClose}>Tutup (Esc)</button>
        </header>

        <section className="roles" aria-label="Penugasan peran provider">
          <label className="field">
            <span>Peran Teks (Script & Storyboard JSON)</span>
            <select value={settings.textProfileId} onChange={(e) => update((s) => ({ ...s, textProfileId: e.target.value }))}>
              <option value="">Tidak aktif (mode offline)</option>
              {settings.profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.text_model ? ` · ${p.text_model}` : ""}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Peran Gambar (Ilustrasi Shot 9:16)</span>
            <select value={settings.imageProfileId} onChange={(e) => update((s) => ({ ...s, imageProfileId: e.target.value }))}>
              <option value="">Tidak aktif (unggah gambar manual)</option>
              {settings.profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.image_model ? ` · ${p.image_model}` : ""}</option>
              ))}
            </select>
          </label>
        </section>

        <div className="settings-grid">
          <aside className="prof-side" aria-label="Daftar profil provider">
            <div className="prof-side-head">
              <strong>Profil provider</strong>
              <button className="btn sm" onClick={addProfile}>+ Tambah</button>
            </div>
            {!settings.profiles.length ? (
              <p className="dim sm-pad">Belum ada profil. Tambah satu profil untuk mulai menghubungkan model AI.</p>
            ) : (
              <ul className="prof-list">
                {settings.profiles.map((p) => {
                  const hasK = !!getKey(p.id);
                  const noKeyNeeded = !PROVIDER_KINDS.find((k) => k.id === p.kind)!.needsKey;
                  const roles = [settings.textProfileId === p.id ? "Teks" : "", settings.imageProfileId === p.id ? "Gambar" : ""].filter(Boolean);
                  return (
                    <li key={p.id}>
                      <button className={`prof-item ${active?.id === p.id ? "on" : ""}`} onClick={() => setSelectedId(p.id)}>
                        <span className="prof-name">{p.name || "Tanpa nama"}</span>
                        <span className="prof-sub dim">
                          {PROVIDER_KINDS.find((k) => k.id === p.kind)?.label}
                          {" · "}
                          {noKeyNeeded ? "Lokal" : hasK ? "Key tersimpan" : "Belum ada key"}
                        </span>
                        {roles.length > 0 && <span className="prof-role">{roles.join(" + ")}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          <section className="prof-edit" aria-label="Detail profil">
            {!active || !kindMeta ? (
              <div className="empty-inline">
                <p>Pilih profil di sebelah kiri atau buat profil baru.</p>
                <button className="btn primary" onClick={addProfile}>Tambah profil provider</button>
              </div>
            ) : (
              <>
                <div className="two">
                  <label className="field">
                    <span>Nama profil</span>
                    <input value={active.name} placeholder="Nama profil, mis. Gemini Kerja"
                      onChange={(e) => patchProfile(active.id, { name: e.target.value })} />
                  </label>
                  <label className="field">
                    <span>Jenis provider</span>
                    <select value={active.kind} onChange={(e) => changeKind(active, e.target.value as ProviderKind)}>
                      {PROVIDER_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                    </select>
                  </label>
                </div>

                <label className="field">
                  <span>Base URL</span>
                  <input value={active.base_url} placeholder="https://api.openai.com/v1"
                    onChange={(e) => patchProfile(active.id, { base_url: e.target.value })} />
                  <small>Koneksi langsung via HTTPS. HTTP tanpa TLS hanya diizinkan untuk localhost atau 127.0.0.1.</small>
                </label>

                <div className="field">
                  <span>API Key {kindMeta.needsKey ? (savedHint ? `(tersimpan: ${savedHint})` : "(kosong)") : "(opsional untuk Ollama lokal)"}</span>
                  <div className="key-row">
                    <input type={showKey ? "text" : "password"} autoComplete="off" spellCheck={false}
                      value={keyDraft} placeholder={kindMeta.needsKey ? "Tempel API key Anda di sini" : "Tidak wajib untuk Ollama lokal"}
                      onChange={(e) => { setKeyDraft(e.target.value); setKey(active.id, e.target.value.trim()); update((s) => ({ ...s })); }} />
                    <button type="button" className="btn ghost" onClick={() => setShowKey((v) => !v)}>{showKey ? "Sembunyikan" : "Tampilkan"}</button>
                    {savedHint && (
                      <button type="button" className="btn ghost danger" onClick={() => { setKeyDraft(""); setKey(active.id, ""); update((s) => ({ ...s })); }}>
                        Hapus key
                      </button>
                    )}
                  </div>
                </div>

                <div className="two">
                  <label className="field">
                    <span>Model teks</span>
                    <input value={active.text_model} placeholder={kindMeta.textHint}
                      onChange={(e) => patchProfile(active.id, { text_model: e.target.value })} />
                  </label>
                  <label className="field">
                    <span>Model gambar (opsional)</span>
                    <input value={active.image_model} placeholder={kindMeta.imageHint}
                      disabled={active.kind === "Anthropic" || active.kind === "OllamaLocal"}
                      onChange={(e) => patchProfile(active.id, { image_model: e.target.value })} />
                  </label>
                </div>

                <details className="fold">
                  <summary>Pengaturan lanjutan (timeout, token, temperature, header)</summary>
                  <div className="adv-grid">
                    <label className="field">
                      <span>Timeout (detik)</span>
                      <input type="number" min={5} max={300} value={active.timeout_secs}
                        onChange={(e) => patchProfile(active.id, { timeout_secs: Math.max(5, Math.min(300, +e.target.value || 60)) })} />
                    </label>
                    <label className="field">
                      <span>Max output tokens</span>
                      <input type="number" min={256} max={32768} value={active.max_output_tokens}
                        onChange={(e) => patchProfile(active.id, { max_output_tokens: Math.max(256, +e.target.value || 4096) })} />
                    </label>
                    <label className="field">
                      <span>Temperature (0 sampai 2)</span>
                      <input type="number" step={0.1} min={0} max={2} value={active.temperature}
                        onChange={(e) => patchProfile(active.id, { temperature: Math.max(0, Math.min(2, parseFloat(e.target.value) || 0)) })} />
                    </label>
                    <label className="field">
                      <span>Header anthropic-version</span>
                      <input value={active.api_version} placeholder="2023-06-01"
                        onChange={(e) => patchProfile(active.id, { api_version: e.target.value })} />
                    </label>
                  </div>
                </details>

                <div className="prof-actions">
                  <button type="button" className="btn primary" disabled={testing} onClick={runTest}>
                    {testing ? "Menguji koneksi…" : "Uji Koneksi"}
                  </button>
                  <span className="spacer" />
                  <button type="button" className="btn ghost danger" onClick={() => removeProfile(active)}>Hapus profil</button>
                </div>

                {testRes && (
                  <p className={testRes.ok ? "ok status-box" : "error status-box"} role="status">
                    <strong>{testRes.ok ? "Berhasil" : "Gagal"}</strong>
                    {testRes.status ? ` (HTTP ${testRes.status})` : ""}: {testRes.ok ? testRes.text : testRes.error}
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
