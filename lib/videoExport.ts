// Export video Langkah 6 — port dari autovideo-studio/src/lib/videoExport.ts,
// disesuaikan ke model Shot storyboard-studio (duration_ms, image data URL,
// caption dari audio, fallback judul shot).
import type { Shot, VideoEngine } from "./data";

export function formatSrtTimestamp(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000);
  return `${String(hrs).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export const shotCaption = (s: Shot) => (s.audio || s.title || "").trim();

export function buildSrtContent(shots: Shot[]): string {
  let cursor = 0;
  const blocks: string[] = [];
  shots.forEach((s, i) => {
    const dur = s.duration_ms / 1000;
    const cap = shotCaption(s);
    if (cap) blocks.push(`${i + 1}\n${formatSrtTimestamp(cursor)} --> ${formatSrtTimestamp(cursor + dur)}\n${cap}\n`);
    cursor += dur;
  });
  return blocks.join("\n");
}

/** Script ffmpeg (.bat) untuk render lokal di laptop user.
    Shot dengan klip Flow (video_url) dipakai langsung sebagai clips/sc_N.mp4
    (unduh dulu dari Langkah 6 dengan nama itu); shot tanpa klip dirender zoom
    dari keyframe_N.png. Subtitle dari captions.srt yang diunduh bersamaan. */
export function buildLocalFfmpegBat(shots: Shot[], engine: VideoEngine): string {
  const width = 1080;
  const height = 1920;
  const fps = 30;
  const zoomScale = 0.25;
  const lines: string[] = [
    "@echo off",
    "echo === Storyboard Studio Local FFmpeg Renderer ===",
    "echo Siapkan di folder ini: keyframe_N.png (shot tanpa klip Flow) dan clips/sc_N.mp4 (klip Flow yang diunduh dari Langkah 6).",
    "mkdir clips 2>nul",
    "",
  ];
  shots.forEach((s, idx) => {
    const num = idx + 1;
    const dur = Math.max(0.5, s.duration_ms / 1000);
    if (s.video_url && s.video_status === "done") {
      lines.push(`echo Shot ${num}: memakai klip Flow clips/sc_${num}.mp4`);
    } else {
      const frames = Math.round(dur * fps);
      const step = (zoomScale / Math.max(frames, 1)).toFixed(6);
      lines.push(
        `ffmpeg -y -loop 1 -i keyframe_${num}.png -vf "scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase,crop=${width * 2}:${height * 2},zoompan=z='min(zoom+${step},${(1 + zoomScale).toFixed(2)})':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${width}x${height}:fps=${fps}" -t ${dur} -c:v libx264 -pix_fmt yuv420p clips/sc_${num}.mp4`,
      );
    }
  });
  lines.push("");
  lines.push("(for %%i in (" + shots.map((_, i) => `clips/sc_${i + 1}.mp4`).join(" ") + ") do @echo file '%%i') > clips.txt");
  lines.push(
    `ffmpeg -y -f concat -safe 0 -i clips.txt -vf "subtitles=captions.srt:force_style='FontName=Arial,FontSize=15,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Alignment=2,MarginV=55'" -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p -c:a aac -b:a 192k final_video.mp4`,
  );
  lines.push("echo Selesai! Output: final_video.mp4");
  lines.push("pause");
  return lines.join("\r\n");
}

export function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Gagal memuat gambar shot."));
    img.src = src;
  });
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.toUpperCase().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export interface ZoomRenderOptions {
  shots: Shot[];
  zoomScale?: number;
  onProgress: (percent: number, logLine: string) => void;
}

/** Render zoom-in gratis langsung di browser (canvas + MediaRecorder).
    Dipakai untuk semua shot — klip Flow tetap bisa di-export lewat .bat / diunduh per shot. */
export async function renderZoomVideoInBrowser({ shots, zoomScale = 0.25, onProgress }: ZoomRenderOptions): Promise<{ blob: Blob; extension: string }> {
  const width = 720;
  const height = 1280;
  const fps = 30;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D tidak tersedia di browser ini.");

  onProgress(5, "Memuat gambar shot ke memori canvas...");
  const loaded: Array<HTMLImageElement | null> = [];
  for (const s of shots) {
    if (s.image) {
      try {
        loaded.push(await loadImage(s.image));
      } catch {
        loaded.push(null);
      }
    } else loaded.push(null);
  }

  const stream = canvas.captureStream(fps);
  const mimeCandidates = [
    "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  const chosenMime =
    mimeCandidates.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) || "video/webm";
  const extension = chosenMime.includes("mp4") ? "mp4" : "webm";
  const chunks: BlobPart[] = [];
  const recorder = new MediaRecorder(stream, { mimeType: chosenMime, videoBitsPerSecond: 4_500_000 });
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  const stopped = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: chosenMime }));
  });
  recorder.start(200);

  const totalMs = shots.reduce((a, s) => a + s.duration_ms, 0);
  const startTime = performance.now();
  onProgress(15, `Encoding stream (${width}x${height} @ ${fps}fps, ${chosenMime})...`);

  await new Promise<void>((resolve) => {
    const drawFrame = () => {
      const elapsed = performance.now() - startTime;
      if (elapsed >= totalMs) {
        resolve();
        return;
      }
      let acc = 0;
      let active = 0;
      let local = 0;
      for (let i = 0; i < shots.length; i++) {
        if (elapsed < acc + shots[i].duration_ms) {
          active = i;
          local = (elapsed - acc) / shots[i].duration_ms;
          break;
        }
        acc += shots[i].duration_ms;
      }
      const shot = shots[active];
      const img = loaded[active];
      ctx.fillStyle = "#0e1118";
      ctx.fillRect(0, 0, width, height);
      if (img) {
        const scale = 1 + zoomScale * local;
        const imgAspect = img.naturalWidth / img.naturalHeight;
        const canvasAspect = width / height;
        let baseW = width;
        let baseH = height;
        if (imgAspect > canvasAspect) {
          baseH = height;
          baseW = height * imgAspect;
        } else {
          baseW = width;
          baseH = width / imgAspect;
        }
        const drawW = baseW * scale;
        const drawH = baseH * scale;
        ctx.drawImage(img, (width - drawW) / 2, (height - drawH) / 2, drawW, drawH);
      } else {
        const grad = ctx.createLinearGradient(0, 0, width, height);
        grad.addColorStop(0, "#171c2b");
        grad.addColorStop(1, "#0b0d14");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);
      }
      const vignette = ctx.createLinearGradient(0, height * 0.65, 0, height);
      vignette.addColorStop(0, "rgba(0,0,0,0)");
      vignette.addColorStop(1, "rgba(0,0,0,0.75)");
      ctx.fillStyle = vignette;
      ctx.fillRect(0, height * 0.65, width, height * 0.35);
      const cap = shotCaption(shot);
      if (cap) {
        const fontSize = 42;
        ctx.font = `900 ${fontSize}px Inter, Arial, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const lines = wrapLines(ctx, cap, width * 0.84);
        const lineHeight = fontSize * 1.2;
        const startY = height - 190 - ((lines.length - 1) * lineHeight) / 2;
        lines.forEach((line, idx) => {
          const y = startY + idx * lineHeight;
          ctx.lineWidth = 10;
          ctx.strokeStyle = "#000000";
          ctx.lineJoin = "round";
          ctx.strokeText(line, width / 2, y);
          ctx.fillStyle = "#FFFFFF";
          ctx.fillText(line, width / 2, y);
        });
      }
      const pct = Math.min(95, Math.round(15 + (elapsed / totalMs) * 80));
      onProgress(pct, `Rendering shot ${active + 1}/${shots.length} (${Math.round(local * 100)}%)...`);
      requestAnimationFrame(drawFrame);
    };
    requestAnimationFrame(drawFrame);
  });

  recorder.stop();
  const blob = await stopped;
  onProgress(100, `Export selesai! Ukuran file: ${(blob.size / (1024 * 1024)).toFixed(2)} MB (.${extension})`);
  return { blob, extension };
}
