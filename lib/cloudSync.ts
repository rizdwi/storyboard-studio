// Sinkronisasi proyek ke Supabase (best-effort): lokal tetap sumber kebenaran bila cloud tidak terjangkau.
import type { Project } from "./data";
import { supabase } from "./supabase";

export const cloudUpsert = async (p: Project): Promise<void> => {
  const sb = supabase();
  if (!sb) return;
  const { error } = await sb.from("projects").upsert({
    id: p.id, title: p.title, premise: p.premise,
    target_secs: p.target_secs, updated_at: p.updated_at, data: p,
  });
  if (error) console.warn("[cloud] upsert gagal:", error.message);
};

export const cloudDelete = async (id: string): Promise<void> => {
  const sb = supabase();
  if (!sb) return;
  const { error } = await sb.from("projects").delete().eq("id", id);
  if (error) console.warn("[cloud] delete gagal:", error.message);
};

export const cloudList = async (): Promise<Project[]> => {
  const sb = supabase();
  if (!sb) return [];
  const { data, error } = await sb.from("projects").select("data").order("updated_at", { ascending: false });
  if (error || !data) { if (error) console.warn("[cloud] list gagal:", error.message); return []; }
  return (data.map((r) => r.data as Project) || []).filter((x) => x && Array.isArray(x.shots));
};

/** Gabung daftar lokal + cloud: cloud menang bila updated_at lebih baru; proyek hanya-di-cloud ditambahkan. */
export const mergeProjects = (local: Project[], remote: Project[]): Project[] => {
  const out = new Map(local.map((p) => [p.id, p]));
  for (const r of remote) {
    const cur = out.get(r.id);
    if (!cur || r.updated_at > cur.updated_at) out.set(r.id, r);
  }
  return [...out.values()].sort((a, b) => b.updated_at - a.updated_at);
};
