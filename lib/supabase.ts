// Klien Supabase (opsional): aktif hanya bila env publik terisi. Tanpa env, aplikasi tetap jalan lokal penuh.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;
export const supabase = (): SupabaseClient | null => {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  client = url && key ? createClient(url, key) : null;
  return client;
};
