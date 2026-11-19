// Model data + preset. Semua tipe pakai union string (bukan enum) supaya file ini
// bisa dijalankan langsung oleh `node` (type stripping) untuk tes parser.

export type Roll = "A" | "B" | "X";
export type ShotType = "EWS" | "WS" | "FS" | "MWS" | "MS" | "MCU" | "CU" | "ECU" | "Insert" | "TwoShot";

export interface Shot {
  id: string;
  title: string;
  beat: string;
  start_ms: number;
  duration_ms: number;
  rolls: Roll[];
  shot_type: ShotType;
  camera_angle: string;
  camera_movement: string;
  action: string;
  visual: string;
  audio: string;
  image?: string; // data URL hasil unggah/generate, disimpan lokal di IndexedDB
  locked: boolean;
}

export interface ArtStylePreset {
  id: string;
  name: string;
  prompt_prefix: string;
  palette: [string, string, string, string]; // latar, tengah, figur, aksen
  preview?: string; // path gambar /styles/*.webp atau data URL unggahan kustom
  is_custom: boolean;
}

export interface Project {
  schema_version: number;
  id: string;
  title: string;
  premise: string;
  target_secs: number;
  story_style: { preset_id: string; rules: string };
  script: string;
  character: { name: string; description: string };
  active_art_style_id: string;
  art_prefix_overrides: Record<string, string>; // prefix bawaan yang sudah disunting
  custom_art_styles: ArtStylePreset[];
  shots: Shot[];
  updated_at: number;
}

export type ProviderKind = "OpenAi" | "Anthropic" | "Gemini" | "XaiGrok" | "OpenRouter" | "OllamaLocal" | "OpenAiCompatible";

export interface ProviderProfile {
  id: string;
  name: string;
  kind: ProviderKind;
  base_url: string;
  text_model: string;
  image_model: string;
  api_version: string;
  timeout_secs: number;
  max_output_tokens: number;
  temperature: number;
}

export const uid = () => crypto.randomUUID();

export const ROLL_COMBOS: { label: string; rolls: Roll[] }[] = [
  { label: "A-Roll", rolls: ["A"] },
  { label: "B-Roll", rolls: ["B"] },
  { label: "X-Roll", rolls: ["X"] },
  { label: "A+B", rolls: ["A", "B"] },
  { label: "A+X", rolls: ["A", "X"] },
  { label: "B+X", rolls: ["B", "X"] },
  { label: "A+B+X", rolls: ["A", "B", "X"] },
];
export const rollLabel = (r: Roll[]) => (r.length === 1 ? `${r[0]}-Roll` : r.join("+"));

export const SHOT_TYPES: { id: ShotType; label: string }[] = [
  { id: "EWS", label: "EWS · Extreme Wide" },
  { id: "WS", label: "WS · Wide" },
  { id: "FS", label: "FS · Full Shot" },
  { id: "MWS", label: "MWS · Medium Wide" },
  { id: "MS", label: "MS · Medium" },
  { id: "MCU", label: "MCU · Medium Close-Up" },
  { id: "CU", label: "CU · Close-Up" },
  { id: "ECU", label: "ECU · Extreme Close-Up" },
  { id: "Insert", label: "Insert · Detail" },
  { id: "TwoShot", label: "Two-Shot" },
];

export const ANGLES = [
  "Eye-Level", "Low Angle (Heroic)", "High Angle", "Bird's-Eye (90°)", "Worm's-Eye",
  "Dutch Angle", "Over-the-Shoulder (OTS)", "POV", "Profile", "Three-Quarter Angle",
];

export const MOVEMENTS = [
  "Static", "Slow Push-In", "Slow Pull-Out", "Dolly Zoom (Vertigo)", "Pan Left", "Pan Right",
  "Whip Pan", "Tilt Up", "Tilt Down", "Tracking", "Crane Up", "Crane Down",
  "Handheld Shaky", "Orbit 360°", "Snorricam",
];

export interface StoryStyle { id: string; name: string; range: string; beats: string[]; rules: string }

export const STORY_STYLES: StoryStyle[] = [
  {
    id: "domino", name: "The Domino", range: "35–55 dtk",
    beats: ["Pemicu kecil", "Reaksi berantai 1", "Reaksi berantai 2", "Eskalasi", "Dampak akhir"],
    rules: "Bangun rantai sebab-akibat yang jelas: setiap shot adalah akibat langsung dari shot sebelumnya. Mulai dari kejadian kecil yang sepele, naikkan taruhan di setiap mata rantai, dan tutup dengan dampak yang tidak terduga tapi logis. Hindari lompatan tanpa sebab.",
  },
  {
    id: "otherside", name: "The Other Side", range: "35–45 dtk",
    beats: ["Sisi pertama", "Petunjuk kecil", "Pergantian sudut pandang", "Plot twist", "Makna baru"],
    rules: "Tampilkan satu situasi dari sudut pandang pertama, lalu balik ke sudut pandang kedua yang mengubah makna semua yang sudah dilihat. Tanam petunjuk visual sejak awal supaya twist terasa adil saat ditonton ulang.",
  },
  {
    id: "horor", name: "Horor Interaktif", range: "60–120 dtk",
    beats: ["Normal", "Anomali pertama", "Aturan dunia", "Ketegangan", "Dilema A/B", "Konsekuensi"],
    rules: "Mulai dari suasana normal, lalu munculkan anomali kecil. Jelaskan satu aturan dunia yang tidak boleh dilanggar. Bangun ketegangan lewat suara dan ruang kosong. Akhiri dengan dilema pilihan A atau B yang ditujukan ke penonton, sertakan konsekuensi singkat untuk masing-masing pilihan.",
  },
  {
    id: "drama", name: "Drama Reflektif", range: "40–60 dtk",
    beats: ["Keadaan diam", "Kenangan", "Konflik batin", "Jeda", "Keputusan kecil"],
    rules: "Fokus pada ekspresi wajah dan detail kecil. Beri ruang jeda emosional tanpa dialog. Gunakan close-up untuk momen batin dan wide shot untuk kesepian. Dialog hemat, biarkan visual bercerita.",
  },
  {
    id: "komedi", name: "Komedi Ringan", range: "20–40 dtk",
    beats: ["Setup", "Eskalasi cepat", "Punchline", "Tag"],
    rules: "Setup dalam 1 sampai 2 shot, eskalasi cepat dengan potongan pendek, punchline visual yang jelas, lalu tag singkat sebagai tawa kedua. Timing adalah segalanya: shot punchline boleh sedikit lebih lama.",
  },
  {
    id: "edukasi", name: "Edukasi Cepat", range: "40–60 dtk",
    beats: ["Pertanyaan pemicu", "Konteks", "Langkah 1", "Langkah 2", "Langkah 3", "Ringkasan"],
    rules: "Buka dengan pertanyaan yang membuat penonton penasaran dalam 2 detik pertama. Jelaskan dengan langkah visual yang konkret, satu ide per shot. Tutup dengan ringkasan satu kalimat yang mudah diingat.",
  },
];

export const ART_STYLES: ArtStylePreset[] = [
  { id: "cinematic", name: "Realistis Sinematik", is_custom: false, preview: "/styles/cinematic.jpg", palette: ["#1c2024", "#3b4650", "#d9cbb8", "#e0a458"],
    prompt_prefix: "cinematic film still, photorealistic, 35mm anamorphic lens, natural lighting, shallow depth of field, subtle film grain" },
  { id: "cartoon", name: "Kartun 2D", is_custom: false, preview: "/styles/cartoon.jpg", palette: ["#24324a", "#4f7cac", "#f4e9d8", "#f08a4b"],
    prompt_prefix: "2D cartoon illustration, clean bold outlines, flat colors, expressive characters, simple shading" },
  { id: "sketch", name: "Sketsa Pensil", is_custom: false, preview: "/styles/sketch.jpg", palette: ["#2a2926", "#6b6862", "#e9e4da", "#c9b48a"],
    prompt_prefix: "graphite pencil storyboard sketch, loose linework, cross-hatching, monochrome, rough paper texture" },
  { id: "lowpoly", name: "Low-Poly 3D", is_custom: false, preview: "/styles/lowpoly.jpg", palette: ["#1f2a2e", "#3f6b6a", "#e3d7c3", "#7fc1b0"],
    prompt_prefix: "low-poly 3D render, faceted geometry, soft studio lighting, minimal pastel palette" },
  { id: "retro90", name: "Retro-Analog 90s", is_custom: false, preview: "/styles/retro90.jpg", palette: ["#2b1f24", "#7a4b54", "#f0dcc4", "#e86a5c"],
    prompt_prefix: "1990s analog camcorder footage, VHS color bleed, soft focus, date stamp aesthetic, warm faded colors" },
  { id: "anime", name: "Anime", is_custom: false, preview: "/styles/anime.jpg", palette: ["#1e2338", "#4a5a8c", "#f6e7e1", "#ef7a9a"],
    prompt_prefix: "anime key visual, cel shading, detailed background art, dramatic lighting, vibrant colors" },
];

export const paletteFromAccent = (accent: string): ArtStylePreset["palette"] => ["#1d1e22", "#45474f", "#e6e1d8", accent];

export const PROVIDER_KINDS: { id: ProviderKind; label: string; base_url: string; textHint: string; imageHint: string; needsKey: boolean }[] = [
  { id: "OpenAi", label: "OpenAI", base_url: "https://api.openai.com/v1", textHint: "mis. gpt-4.1-mini", imageHint: "mis. gpt-image-1", needsKey: true },
  { id: "Anthropic", label: "Anthropic", base_url: "https://api.anthropic.com", textHint: "mis. claude-sonnet-4-5", imageHint: "tidak didukung", needsKey: true },
  { id: "Gemini", label: "Google Gemini", base_url: "https://generativelanguage.googleapis.com", textHint: "mis. gemini-2.5-flash", imageHint: "mis. gemini-2.5-flash-image", needsKey: true },
  { id: "XaiGrok", label: "Grok / xAI", base_url: "https://api.x.ai/v1", textHint: "mis. grok-4", imageHint: "mis. grok-2-image", needsKey: true },
  { id: "OpenRouter", label: "OpenRouter", base_url: "https://openrouter.ai/api/v1", textHint: "mis. anthropic/claude-sonnet-4.5", imageHint: "mis. google/gemini-2.5-flash-image", needsKey: true },
  { id: "OllamaLocal", label: "Ollama Lokal", base_url: "http://localhost:11434/v1", textHint: "mis. llama3.1", imageHint: "tidak didukung", needsKey: false },
  { id: "OpenAiCompatible", label: "Kompatibel OpenAI (Kustom)", base_url: "", textHint: "nama model di endpoint Anda", imageHint: "opsional", needsKey: true },
];

export const newProfile = (kind: ProviderKind = "OpenAi"): ProviderProfile => {
  const k = PROVIDER_KINDS.find((p) => p.id === kind)!;
  return {
    id: uid(), name: k.label, kind, base_url: k.base_url, text_model: "", image_model: "",
    api_version: kind === "Anthropic" ? "2023-06-01" : "", timeout_secs: 180, max_output_tokens: 4096, temperature: 0.8,
  };
};

/** Profil bawaan: Gemini Google untuk naskah & gambar.
    Key TIDAK disimpan di sini — key dibaca dari env server (/api/ai) bila profil belum punya key sendiri.
    Hydrogen (9Router) DIHAPUS 19 Nov atas perintah user: tanpa tunnel, tanpa Hermes/InstaBox. */
export const DEFAULT_GEMINI_ID = "default-gemini-google";

export const defaultProfiles = (): ProviderProfile[] => [
  {
    id: DEFAULT_GEMINI_ID, name: "Gemini (Google)", kind: "Gemini",
    base_url: "https://generativelanguage.googleapis.com", text_model: "gemini-2.5-flash",
    image_model: "gemini-2.5-flash-image", api_version: "", timeout_secs: 180,
    max_output_tokens: 8192, temperature: 0.8,
  },
];

export const newShot = (patch: Partial<Shot> = {}): Shot => ({
  id: uid(), title: "", beat: "", start_ms: 0, duration_ms: 3000, rolls: ["A"], shot_type: "MS",
  camera_angle: "Eye-Level", camera_movement: "Static", action: "", visual: "", audio: "", locked: false, ...patch,
});

export const newProject = (): Project => ({
  schema_version: 2, id: uid(), title: "Proyek tanpa judul", premise: "", target_secs: 45,
  story_style: { preset_id: STORY_STYLES[0].id, rules: STORY_STYLES[0].rules }, script: "",
  character: { name: "", description: "" }, active_art_style_id: ART_STYLES[0].id, art_prefix_overrides: {},
  custom_art_styles: [], shots: [], updated_at: Date.now(),
});

/** Hitung ulang start_ms berurutan dari durasi; dipanggil setiap kali urutan/durasi berubah. */
export const retime = (shots: Shot[]): Shot[] => {
  let t = 0;
  return shots.map((s) => {
    const out = s.start_ms === t ? s : { ...s, start_ms: t };
    t += s.duration_ms;
    return out;
  });
};

export const tc = (ms: number) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export const allArtStyles = (p: Project) => [...ART_STYLES, ...p.custom_art_styles];
export const activeArt = (p: Project) => allArtStyles(p).find((a) => a.id === p.active_art_style_id) ?? ART_STYLES[0];
export const activePrefix = (p: Project) => {
  const a = activeArt(p);
  return a.is_custom ? a.prompt_prefix : p.art_prefix_overrides[a.id] ?? a.prompt_prefix;
};

export const shotLabel = (t: ShotType) => SHOT_TYPES.find((s) => s.id === t)?.label.split(" · ").pop() ?? t;

export const buildPrompt = (p: Project, s: Shot) =>
  [
    activePrefix(p),
    p.character.name || p.character.description ? `Karakter: ${[p.character.name, p.character.description].filter(Boolean).join(", ")}` : "",
    `${shotLabel(s.shot_type)} shot, ${s.camera_angle}, ${s.camera_movement}`,
    s.action && `Aksi: ${s.action}`,
    s.visual && `Visual: ${s.visual}`,
    "vertical 9:16 composition",
  ].filter(Boolean).join(". ");
