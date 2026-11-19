"""Bridge Gemini web (gemini.google.com) via cookie sesi Google.

Fungsi serverless Python di Vercel — tanpa server/box/tunnel tambahan.
Model web ditemukan dinamis per akun oleh gemini-webapi, jadi nama web
("hydrogen", "neon", "carbon") langsung bisa dipakai tanpa hardcode.

GET  /api/web-ai -> {"ok": true, "web": bool} (cookie terpasang?)
POST /api/web-ai
  {"op": "text"|"image"|"test", "prompt": str, "model": "hydrogen"|"neon"|"carbon",
   "extended_thinking": bool}
  -> {"ok": true, "text": str, "images": [dataURL]} atau {"ok": false, "error": str}

Env (Vercel, Secret): GEMINI_WEB_PSID (__Secure-1PSID), GEMINI_WEB_PSIDTS
(__Secure-1PSIDTS). Nilai TIDAK PERNAH ditulis ke repo/log.
"""
import asyncio
import base64
import json
import mimetypes
import os
from http.server import BaseHTTPRequestHandler

PSID = os.environ.get("GEMINI_WEB_PSID", "")
PSIDTS = os.environ.get("GEMINI_WEB_PSIDTS", "")

WEB_MODELS = [
    {"id": "hydrogen", "name": "4 Hydrogen", "label": "Bantuan sehari-hari"},
    {"id": "neon", "name": "4 Neon", "label": "Deeper analysis"},
    {"id": "carbon", "name": "4 Carbon", "label": "Code & complex work"},
]


class handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send(200, {"ok": True, "web": bool(PSID and PSIDTS)})

    def do_POST(self):
        try:
            n = int(self.headers.get("content-length") or 0)
            data = json.loads(self.rfile.read(n) or b"{}")
        except Exception:
            return self._send(400, {"ok": False, "error": "Body JSON tidak valid."})
        if not PSID or not PSIDTS:
            return self._send(200, {
                "ok": False,
                "error": "Cookie Gemini web belum dipasang di server (env GEMINI_WEB_PSID + GEMINI_WEB_PSIDTS).",
            })
        try:
            res = asyncio.run(run(data))
        except Exception as e:
            return self._send(200, {"ok": False, "error": f"Bridge web gagal: {e}"})
        self._send(200, res)


async def run(data):
    from gemini_webapi import GeminiClient

    op = (data.get("op") or "text").strip()
    prompt = data.get("prompt") or ""
    model = (data.get("model") or "hydrogen").strip().lower()
    extended = bool(data.get("extended_thinking"))
    client = GeminiClient(secure_1psid=PSID, secure_1psidts=PSIDTS)
    await client.init(auto_refresh=False)
    try:
        if op == "test":
            names = []
            try:
                reg = getattr(client, "_model_registry", {}) or {}
                names = [m.display_name for m in reg.values()
                         if getattr(m, "is_available", True)]
            except Exception:
                names = []
            label = ", ".join(names) if names else "Hydrogen, Neon, Carbon"
            return {"ok": True, "text": f"Terhubung ke Gemini web. Model: {label}.",
                    "models": WEB_MODELS}
        out = await client.generate_content(
            prompt, model=model, extended_thinking=extended)
        text = (getattr(out, "text", "") or "").strip()
        images = []
        for img in (getattr(out, "images", None) or []):
            path = None
            for kw in ({"full_size": True}, {}):
                try:
                    path = await img.save("/tmp", **kw)
                    break
                except Exception:
                    path = None
            if not path:
                continue
            try:
                with open(path, "rb") as f:
                    raw = f.read()
                mime = mimetypes.guess_type(path)[0] or "image/jpeg"
                images.append("data:" + mime + ";base64,"
                              + base64.b64encode(raw).decode())
            except Exception:
                continue
        if op == "image" and not images:
            return {"ok": False,
                    "error": "Gemini web tidak mengembalikan gambar untuk prompt ini. "
                             "Coba prompt yang lebih visual."}
        return {"ok": True, "text": text, "images": images}
    finally:
        try:
            await client.close()
        except Exception:
            pass
