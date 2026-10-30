# Kusum 0.1 — Patient Monitoring Prototype (software-only)

Hospital-side camera monitoring with privacy-safe guardian viewing.

- **Hospital dashboard** (staff): register patients + guardian info, verify guardian
  access requests (side-by-side), assign each patient a **strict bounding box**
  (YOLO auto-detection of ALL beds + manual draw) over the live blurred view,
  watch the whole ward, full audit log.
- **Guardian PWA**: guardian signs in, submits matching identity info, hospital
  staff approve, and the guardian sees ONLY the cropped stream of their own
  patient's bed — never the full frame, never other patients.
- **Vision worker**: pulls the camera RTSP feed, runs YOLO bed detection (keeps
  every bed box, not just one) + NudeNet nudity detection, blurs nudity
  server-side, and publishes the safe ward stream plus per-patient crops.
  **Fail-closed:** any detector error = full-frame blur, never raw passthrough.

```
IP camera (or simulated RTSP)                     guardian PWA ─┐
        │  raw, internal only                                   ├─ WebRTC (token-gated)
        ▼                                             dashboard ─┘
[MediaMTX :8554] → [vision worker: YOLO beds + NudeNet blur + per-bed crops]
                          │  publishes room_X_blurred, patient_<id>
                          ▼
                  [MediaMTX :8889 WebRTC] ← auth hook → [Fastify API :3001 + SQLite]
```

## Repo layout
```
apps/api             Fastify API + node:sqlite (auth, patients, requests, tokens, audit)
apps/dashboard       React+Vite staff dashboard (:5173)
apps/guardian-pwa    React+Vite guardian PWA (:5174)
services/vision      Python worker: worker.py (+ models/best.pt YOLO bed model)
infra                mediamtx.yml, camera simulator scripts, downloaded binaries in bin/
```

## One-time setup
1. Node deps: `cd apps/api && npm i` (repeat in `apps/dashboard`, `apps/guardian-pwa`)
   — already installed if this repo was set up by the assistant.
2. Python deps: `pip install -r services/vision/requirements.txt`
   (numpy, opencv-python, ultralytics; nudenet optional for `--mock` runs).
3. Binaries: `infra/bin/mediamtx.exe` and `infra/bin/ffmpeg.exe` are downloaded
   portable builds. If missing, get MediaMTX from
   https://github.com/bluenviron/mediamtx/releases and ffmpeg from gyan.dev and
   drop both `.exe` into `infra/bin/`.

## Run (5 terminals, from the repo root)
```sh
# 1. Media server
cd infra && bin/mediamtx.exe mediamtx.yml

# 2. Simulated camera (or: set SAMPLE=path\to\ward-clip.mp4 for real footage)
cd infra && set MEDIA_SECRET=devmedia && simulate_camera.cmd room_1
# (a real IP camera instead: just publish/pull its RTSP stream as room_1)

# 3. Vision worker (mock blur) — use --model for real NudeNet detection
set MEDIA_SECRET=devmedia
python services/vision/worker.py --camera room_1 --mock

# 4. API (seeds admin + demo patient on first boot)
cd apps/api && npm start          # http://localhost:3001

# 5. Frontends
cd apps/dashboard && npm run dev      # http://localhost:5173  (staff)
cd apps/guardian-pwa && npm run dev   # http://localhost:5174  (guardians)
```

## Demo walkthrough
> **Node PATH note (this machine):** `node` was missing from the Windows PATH, so
> `npm start` / `npm run dev` failed with *"'node' is not recognized"*. This was
> fixed by appending `C:\Program Files\nodejs` to the user PATH — **open a new
> terminal** so it picks up the change. Git Bash users can also run components
> directly: `node src/server.js` (api), `node node_modules/vite/bin/vite.js`
> (frontends).
1. **Staff** — sign in at :5173 with `admin@hospital.test` / `admin123`.
   The demo patient *Rahul Sharma* (bed W-101, code `KSM-DEMO01`) is pre-seeded.
2. **Guardian** — at :5174 create an account, then start verification:
   linking code `KSM-DEMO01`, patient name `Rahul Sharma`, guardian name
   `Sunita Sharma`, phone `9876543210`. A wrong entry is rejected client-side
   against the hospital record. Status becomes **PENDING**.
3. **Staff** — open *Requests*, verify submitted vs. record side-by-side. The
   bbox editor shows blue auto-detected beds (YOLO, all beds in frame); click
   the right one (or drag a box), press **Approve**.
4. **Guardian** — refresh: the live cropped view of that bed unlocks. Only
   pixels inside the assigned box are ever sent; the full blurred ward view is
   staff-only. Rejecting/revoking access kills playback on next connection.
5. Staff *Live view* shows the whole ward (privacy-blurred) with bed overlays;
   *Audit* records every login, approval, and edit.

## Security notes (prototype scope)
- Raw camera video never leaves the ingest side; only blurred streams are
  distributed, through MediaMTX's auth hook with short-lived scoped tokens.
- Guardian access is re-checked against the DB at every playback start, so
  revocation is immediate.
- Passwords use scrypt; media tokens are HMAC-signed and expire in 2 minutes.
- **Not yet production-hardened:** HTTPS/TLS termination, rate limiting and
  lockout, HIPAA/GDPR compliance review, GPU inference at scale, edge (in-
  hospital) blur, push notifications, app-store packaging.

## Single-bed detection bug — what was fixed
Bed detection now returns **every** YOLO box above `BED_CONF = 0.30`
(`services/vision/worker.py`, `BedDetector.detect`); the old behavior of taking
only the top-scoring detection is what made multi-bed wards show one bed.
Confidence and threshold are tunable; per-class NMS is left to the model.
