# Reelody — deployment

`run.sh` is for your laptop: it pip-installs on every start, builds the UI if it's
missing, backgrounds the lyrics sidecar behind a shell trap, and binds `127.0.0.1`
because the app is for you and not the network. None of that is wrong, and none of it
belongs on a box other people can reach.

This document is the other half: what Reelody actually needs from a host, three ways to
give it that (a GCP VM under systemd, an EC2 instance under PM2, and containers), and the
operational bits — TLS, OAuth on a real domain, Instagram cookies without a browser,
backups, updates, and the failures you should expect to see first.

Read [README.md](../README.md) for what the app does and every setting it takes, and
[API.md](API.md) for the endpoint contract. This file assumes both.

**If you want the short answer:** one x86 VM with 2 vCPU and 8 GB of RAM, MongoDB on the
same disk, the two app processes under systemd or PM2, and Caddy in front for automatic
HTTPS. Containers if you'd rather have the whole thing reproducible; the same constraints
apply either way.

---

## 0. Five constraints that decide everything else

Read these before you pick a platform. Every recommendation below follows from them, and
most hosting options that look attractive fail on one of them.

### 1. One process. One worker. Never two.

`--workers 4` does not make this app faster, it makes it broken. Three separate reasons:

- **Extract tokens and identify jobs live in process memory** (`_tokens` in
  `backend/services/extractor.py`, `_jobs` in `backend/services/ident_jobs.py`). Pasting
  a reel link gives you a token; `POST /api/songs` redeems it. With two workers the save
  lands on the wrong one roughly half the time and the song can't be saved.
- **The ingest and lyrics workers are started once in `on_startup`.** Two app processes
  means two workers draining the same Mongo queues. The claim is atomic so no job runs
  twice, but two reels download at once — which is precisely what the single-file queue
  exists to prevent, because Instagram rate-limits a session that asks too fast.
- **The lyrics worker keeps its per-host politeness state in process memory.** Two of
  them means two crawlers that each think they're the only one being polite.

So: uvicorn with its default single worker, PM2 in **fork** mode with `instances: 1`,
Compose with one replica and no `scale`. Reelody scales **up**, never out. On a personal
instance that's not a limitation — the bottleneck is Instagram and ffmpeg, not Python.

### 2. The database holds the music

Audio lives in **GridFS**, not a bucket. Consequences:

- Mongo's disk *is* your music disk. Budget for it (§2).
- Backups are `mongodump`, not a bucket sync (§14).
- A 512 MB free database tier holds a few hundred clips and then stops being a
  deployment. MongoDB Atlas M0 is not an option here; self-host, or pay for a tier with
  real storage.
- Every audio byte travels Mongo → app → browser. Keep the database on the same host, or
  at least in the same zone, or you pay egress on every play.

### 3. One of the three processes must never be reachable

The lyrics sidecar on `:4001` has no sign-in, no CORS, no ownership checks and no quota.
That's by design — `backend/services/lyrics.py` is its only permitted caller, and Python
settles who you are, what's yours and what you have left before a request ever reaches
it. Loopback on a VM, a private network in Compose, **never** a published port and never
a proxy route. If `:4001` is reachable from the internet, anyone can spend your Gemini
key.

### 4. The heavy work is CPU-bound and happens inside the API process

ffmpeg transcoding, Shazam decoding, and — for file identification — Whisper `medium` at
int8 on CPU, which runs for **minutes** per file and pins a core while it does. This is
what sizes your instance, and it's why burstable instances at default credit settings are
a trap (§9).

### 5. Instagram is the fragile dependency, and a server makes it worse

`INSTA_COOKIES_BROWSER` works by reading a logged-in **browser profile** off the disk.
A server has no browser profile. On a headless host it's `cookies.txt` or nothing (§7).
Datacenter IP ranges also draw more challenges and rate limits from Instagram than home
connections do — so if extraction is the feature you care most about, running the app on
a machine at home behind a tunnel genuinely works better than running it in a cloud
region. That's not a popular answer, but it's the true one.

---

## 1. What you are deploying

Three processes and one database, started together on your laptop by `run.sh`, supervised
separately in production.

| Process | What it is | Port | Bind | If it's down |
| --- | --- | --- | --- | --- |
| **API** | `uvicorn backend.main:app` — FastAPI + Motor. Owns all state, every access decision, the ingest and lyrics queues, and serves `frontend/dist` from a catch-all route | 8000 | loopback / container network only | the app is down |
| **Lyrics sidecar** | `node lyrics-node/dist/index.js` — the crawler, the Rekhta dictionary and the Gemini call | 4001 | **loopback only, always** | lyrics lookups 502; everything else is fine |
| **MongoDB** | the library, the queues, the sessions, and the audio in GridFS | 27017 | loopback | the app starts and nothing loads |
| *(Reverse proxy)* | nginx or Caddy — TLS, the public port, upload limits | 80/443 | public | no public access |

The SPA is not a process. `frontend/dist` is built once per deploy and served by the API
from a route registered after the API routers, so one origin serves the whole app. There
is no second web server to deploy, no CDN to configure, and no CORS to get wrong — note
that `backend/main.py` hard-codes its CORS allowance to `localhost:5173` for the Vite dev
server, so if you ever do serve the frontend from a different origin you have to change
that line. Don't; same-origin is the whole point of the catch-all.

### Where state lives

| State | Where | Survives a restart | Backed up by |
| --- | --- | --- | --- |
| Songs, playlists, users, play counts | Mongo collections | yes | `mongodump` |
| **The MP3s themselves** | **Mongo GridFS** | yes | `mongodump` |
| Sessions | `sessions` collection, TTL index | yes, expire on their own | not worth it |
| Ingest queue (shared reels) | `ingest_jobs` collection | yes — anything `running` is requeued at boot | `mongodump` |
| Lyrics jobs and results | `lyrics` collection | yes | `mongodump` |
| Quota holds | `quota_holds` collection | yes — orphans refunded at boot | `mongodump` |
| Extract tokens, identify jobs | **process memory** | **no** — gone on restart, by design | n/a |
| Pre-save temp audio | `backend/downloads/`, `backend/uploads/` | scratch only | no |
| Found lyrics, Gemini explanations, Rekhta words | `backend/lyrics-cache/` | yes, on disk | no — losing it costs money and time, not data |
| Whisper model (~1 GB) | HuggingFace cache (`HF_HOME`) | yes, on disk | no — re-downloads |

The "no" rows are what makes a restart cheap: the only thing you lose is an extraction
somebody hadn't saved yet. The practical rule is in §13 — deploy when the Inbox is empty.

---

## 2. Sizing the host

| What drives it | Requirement |
| --- | --- |
| Whisper `medium` int8 on CPU (the lyrics tier of file identification) | ~2–2.5 GB RAM while transcribing, and it will peg a core for minutes |
| ffmpeg + Shazam decode per extraction | a second core, briefly |
| MongoDB WiredTiger cache | takes ~50% of (RAM − 1 GB) by default |
| Node sidecar | ~150 MB, plus whatever a crawl of 8 pages holds |
| The model file on disk | ~1 GB, once, under `HF_HOME` |

**Recommended:** 2 vCPU / 8 GB RAM / 30 GB SSD, x86_64.

**Minimum that works:** 2 vCPU / 4 GB — but add a 2 GB swap file, or the OOM killer will
eventually choose between mongod and a Whisper run and you won't like either outcome:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**Stay on x86_64.** ARM (Graviton, `t2a`) can work, but you're betting on aarch64 wheels
for `ctranslate2`, `shazamio-core` and `pyacoustid` lining up. If you try it, verify the
whole `pip install -r requirements.txt` before you build anything else on top.

**Disk budget.** At the default `AUDIO_QUALITY=192`, a reel clip of 15–90 s is roughly
0.4–2 MB, so about 1.5 GB per thousand songs, and audio doesn't compress in WiredTiger.
Add the Mongo journal, the ~1 GB model, the lyrics cache and the OS: 30 GB is comfortable
for a personal library, 20 GB is tight, and you should alarm on disk before it's full
rather than after (§16).

---

## 3. Picking a shape

| Shape | Good when | Cost of it |
| --- | --- | --- |
| **One VM, systemd** (§8) | the default. Nothing between you and the logs | you manage the OS |
| **One VM, PM2** (§9) | you already run Node services this way and want one dashboard for both processes | PM2 is a second supervisor on top of systemd |
| **Docker Compose on one VM** (§10) | reproducible, moves between hosts, no "works on my box" | an extra layer to debug; Mongo in a container needs its volume treated seriously |
| **Home machine + Cloudflare Tunnel** (§11) | extraction matters most, and you want a residential IP for Instagram | the machine has to be awake when you share a reel |

### What will not work, and why

Worth stating plainly, because these are the options people reach for first:

- **Cloud Run / App Runner / any scale-to-zero container host.** You'd have to pin it to
  exactly one instance (constraint 1), keep the CPU allocated outside requests or the
  background workers freeze (4), bake the 1 GB Whisper model into the image or re-download
  it every cold start (4), and move the audio to a paid Atlas tier because there's no
  local disk (2). It is *possible* — min=1, max=1, CPU always on, the sidecar as a
  sidecar container on localhost — and by then it costs more than the VM and is harder to
  debug. Pick the VM.
- **Lambda / Cloud Functions.** 15-minute ceiling, no persistent process, no background
  worker, no 1 GB model. No.
- **Vercel / Netlify / Cloudflare Pages.** These host the SPA, which is the one piece
  that doesn't need hosting — FastAPI already serves it, and splitting it off means
  rewriting the CORS line and giving up same-origin cookies for nothing.
- **Any free Postgres/Mongo tier under 1 GB.** See constraint 2.
- **Kubernetes.** A single-replica stateful app with a loopback sidecar. You'd be
  writing a StatefulSet to get what one systemd unit already gives you.

---

## 4. Preparing the host (common to §8 and §9)

Ubuntu 24.04 LTS, which ships Python 3.12 — exactly what the app wants. Run everything
below as a sudo-capable user; the app itself will run as its own unprivileged account.

### 4.1 System packages

```bash
sudo apt-get update && sudo apt-get upgrade -y
sudo apt-get install -y \
  python3.12 python3.12-venv python3-pip \
  ffmpeg libchromaprint1 libgomp1 \
  git curl ca-certificates ufw
```

Why the odd ones:

- **`ffmpeg`** — not optional. yt-dlp's MP3 postprocessing, Shazam's decoder and the
  AcoustID tier all shell out to it.
- **`libchromaprint1`** — `pyacoustid` calls the chromaprint shared library directly
  (`backend/services/file_identify.py` drives it off ffmpeg's PCM so it doesn't need the
  `fpcalc` binary). Missing, the AcoustID tier is skipped *in silence*.
- **`libgomp1`** — ctranslate2 (under `faster-whisper`) needs OpenMP.

### 4.2 Node 20+

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v   # expect v22.x
```

### 4.3 MongoDB 8

```bash
curl -fsSL https://www.mongodb.org/static/pgp/server-8.0.asc \
  | sudo gpg -o /usr/share/keyrings/mongodb-server-8.0.gpg --dearmor
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-8.0.gpg ] https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/8.0 multiverse" \
  | sudo tee /etc/apt/sources.list.d/mongodb-org-8.0.list
sudo apt-get update && sudo apt-get install -y mongodb-org
sudo systemctl enable --now mongod
mongosh --quiet --eval 'db.version()'
```

Leave `/etc/mongod.conf` with `bindIp: 127.0.0.1`. The app connects over loopback and
nothing else should connect at all. (MongoDB 5.0+ needs a CPU with AVX — any current
instance type has it, but it's the reason an ancient instance family fails to start
mongod.)

### 4.4 A user and the code

```bash
sudo useradd --system --create-home --home-dir /opt/reelody --shell /usr/sbin/nologin reelody
sudo -u reelody git clone <your-repo-url> /opt/reelody/app
cd /opt/reelody/app
```

Paths below assume `/opt/reelody/app`. Adjust in one place if you put it elsewhere.

### 4.5 The two env files

Both are gitignored, so they don't exist on a fresh clone — you create them. The backend
reads its own (`backend/config.py` has a hand-rolled parser; a real environment variable
always wins), and the sidecar reads its own through dotenv.

```bash
sudo -u reelody tee /opt/reelody/app/backend/.env >/dev/null <<'EOF'
GOOGLE_CLIENT_ID=123-abc.apps.googleusercontent.com
ADMIN_EMAILS=you@example.com
ALLOWED_EMAILS=you@example.com,friend@example.com
SESSION_COOKIE_SECURE=1
MONGO_URL=mongodb://127.0.0.1:27017
DB_NAME=reel_audio
AUDIO_QUALITY=192
INSTA_COOKIES_BROWSER=
EOF

sudo -u reelody tee /opt/reelody/app/lyrics-node/.env >/dev/null <<'EOF'
GEMINI_API_KEY=your-google-ai-studio-key
EOF

sudo chmod 600 /opt/reelody/app/backend/.env /opt/reelody/app/lyrics-node/.env
```

See §5 for what each line does and §6 for where the client ID comes from.

### 4.6 Build it

```bash
cd /opt/reelody/app

sudo -u reelody python3.12 -m venv .venv
sudo -u reelody ./.venv/bin/pip install --upgrade pip
sudo -u reelody ./.venv/bin/pip install -r requirements.txt

sudo -u reelody bash -c 'cd frontend && npm ci && npm run build'
sudo -u reelody bash -c 'cd lyrics-node && npm ci && npm run typecheck && npm run build'

# The sidecar's cache directory, created now rather than by the service: the
# unit in 8.3 runs with ProtectSystem=strict, and systemd refuses to start a
# unit whose ReadWritePaths don't exist.
sudo -u reelody mkdir -p /opt/reelody/app/backend/lyrics-cache
sudo -u reelody mkdir -p /opt/reelody/.cache/huggingface
```

`frontend/dist` and `lyrics-node/dist` both have to exist before you start anything: no
`dist` in the frontend means the catch-all route isn't registered at all and you get JSON
404s instead of an app, and no `dist` in the sidecar means `node dist/index.js` exits
immediately.

There is **no test suite** in this repo — not pytest, not vitest. A clean
`npm run build`, a clean `npm run typecheck`, and the smoke test in §12 are the
verification you get. Treat all three as mandatory before you call a deploy done.

### 4.7 Pre-warm the Whisper model

The lyrics tier of file identification downloads ~1 GB from HuggingFace the first time it
runs. Do it now, as the app's user, so the model lands in the cache the service will
actually read — and so the first person to upload a file doesn't wait out a download on
top of a transcription:

```bash
sudo -u reelody HF_HOME=/opt/reelody/.cache/huggingface \
  /opt/reelody/app/.venv/bin/python -c \
  "from faster_whisper import WhisperModel; WhisperModel('medium', device='cpu', compute_type='int8'); print('model cached')"
```

Set the same `HF_HOME` in the service definition (§8.3, §9.2). If you don't, and
systemd's idea of `$HOME` differs from the shell's, you'll download it twice and wonder
where the disk went.

---

## 5. Production settings reference

Every variable is documented in the README; this is the subset that a deployment gets
wrong. All of these go in `backend/.env` unless the table says otherwise.

### Must change from the default

| Variable | Default | What happens if you leave it |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | empty | the app runs and nobody can sign in — the login screen says so |
| `ADMIN_EMAILS` | **the author's address** | you are not the admin of your own instance. Set it to yours |
| `SESSION_COOKIE_SECURE` | off | fine on http, wrong over https: set it to `1` so the session cookie is https-only |
| `ALLOWED_EMAILS` | empty = **anyone with a Google account** | any stranger who finds the URL gets a library, an extraction quota, and a share of your Gemini bill |
| `GEMINI_API_KEY` *(in `lyrics-node/.env`)* | empty | lyrics are still found and stored; the explanation is skipped and the page says why |

### Set per process, not in the env file

| Variable | Process | Value | Why |
| --- | --- | --- | --- |
| `PORT` | sidecar | `4001` | **its own default is 4000**, while the backend looks for it on 4001. Mismatch here is the single most common "lyrics 502" |
| `CACHE_DIR` | sidecar | absolute, e.g. `/opt/reelody/app/backend/lyrics-cache` | dotenv resolves relative paths against the working directory, so a relative value scatters caches wherever the process started |
| `HF_HOME` | API | `/opt/reelody/.cache/huggingface` | one model download, in a place you know |
| `INSTA_COOKIES_BROWSER` | API | empty string | there is no browser profile on a server; leaving it at `chrome` just means a pointless extraction attempt on every call (§7) |
| `ACOUSTID_API_KEY` | API | optional, free from acoustid.org | without it the AcoustID tier is skipped silently |

### Worth knowing

| Variable | Default | Note |
| --- | --- | --- |
| `LYRICS_SIDECAR_URL` | `http://127.0.0.1:4001` | change to `http://lyrics:4001` in Compose |
| `LYRICS_TIMEOUT` | `240` | a crawl walks up to 8 pages at 8 s each, then Gemini takes its time. It runs in a background worker, so nothing is holding a socket open |
| `FREE_REEL_LIMIT` / `FREE_FILE_LIMIT` / `FREE_LYRICS_LIMIT` / `FREE_MEANING_LIMIT` | 5 / 5 / 5 / 2 | lifetime, per account. Changing one moves everyone still on the default; accounts an admin has edited stay as set |
| `LEGACY_OWNER_EMAIL` | empty | who adopts pre-login rows. Unset, the first account to sign in takes them — on a public instance, set this, or a stranger inherits your library |
| `SESSION_DAYS` | `30` | session lifetime |
| `MAX_UPLOAD_BYTES` | 64 MB (constant) | set the proxy's body limit above it (§11) |

---

## 6. Google sign-in on a real domain

The client ID is not a secret — the browser gets a token from Google and the server
verifies it against Google's public keys locally — so it's safe in an env file and in the
`GET /api/auth/config` response. But the **origin** is matched exactly, which is where
deployments break.

1. [Google Cloud console → Credentials](https://console.cloud.google.com/apis/credentials)
   → **Create credentials → OAuth client ID → Web application**.
2. Under **Authorised JavaScript origins**, add every address the app is actually opened
   at, scheme included:
   - `https://reelody.example.com` — production
   - `http://localhost:5173` — only if you also develop against this client ID
   
   No redirect URI. There is no redirect in this flow.
3. Consent screen: **External**, with yourself as a test user, is enough for a personal
   instance. Only the default name/email/picture scopes are used. If you add real users
   beyond the test list, you'll need to publish the app.
4. Put the ID in `backend/.env` and restart the API.

Two failure modes to recognise: a client ID registered for `localhost` refuses
`127.0.0.1` and vice versa, and a production domain **must** be https — Google Identity
Services exempts `localhost` only. The symptom for both is a sign-in button that does
nothing visible, with an origin error in the browser console.

Also set `SESSION_COOKIE_SECURE=1` the moment you're behind https. Getting it backwards —
`secure` set while serving plain http — presents as signing in successfully and being
signed out again on the next page load, because the browser silently drops the cookie.

---

## 7. Instagram access on a headless box

This is the part of the app that a server makes *harder*, and it's worth setting
expectations: Instagram serves very little to anonymous requests, and a datacenter IP
collects more challenges than a home one.

**`INSTA_COOKIES_BROWSER` is useless here.** It reads cookies out of an actual browser
profile on disk — `~/.config/google-chrome/Profile 4/Cookies` and friends. A server has
none. Set it to empty and use a cookie file.

**Export a `cookies.txt`:**

1. In a browser where you're signed in to Instagram, use a "Get cookies.txt" extension to
   export the `instagram.com` cookies in Netscape format.
2. Copy it to the **repo root** on the server — `backend/config.py` looks for
   `BASE_DIR / "cookies.txt"`, which is `/opt/reelody/app/cookies.txt`. It's picked up
   automatically.

```bash
sudo -u reelody install -m 600 /dev/stdin /opt/reelody/app/cookies.txt < cookies.txt
```

**Confirm it's working** — `/api/health` reports the cookie state separately from who's
signed in:

```bash
curl -s 127.0.0.1:8000/api/health
# {"ok":true,"storage":"gridfs","authenticated":true,"signed_in":false}
#                                  ^^^^^^^^^^^^^^^^^^ the Instagram session
```

`authenticated: false` means extraction will fail on anything but a public reel, usually
with "login required". The file is gitignored, so it never ends up in an image or a
commit; it does expire, and when it does the fix is to export it again. Nothing in the
app warns you — `/api/health` is how you check, which makes it a good thing to poll (§16).

If extraction keeps failing from a cloud IP even with fresh cookies, that's Instagram
declining the IP, not a bug. The honest options are to pace it slowly (the queue already
does one at a time), or to run the app at home behind a tunnel (§11.3) so the outbound
requests come from a residential connection.

---

## 8. GCP — Compute Engine + systemd

### 8.1 The instance

```bash
gcloud compute instances create reelody \
  --zone=asia-south1-a \
  --machine-type=e2-standard-2 \
  --image-family=ubuntu-2404-lts-amd64 --image-project=ubuntu-os-cloud \
  --boot-disk-size=30GB --boot-disk-type=pd-balanced \
  --tags=http-server,https-server
```

`e2-standard-2` is 2 vCPU / 8 GB — the recommendation from §2. `e2-medium` (4 GB) works
with swap. Spot/preemptible is tempting and wrong: a preemption mid-extraction loses
unsaved work and restarts the process.

Open only what the proxy needs:

```bash
gcloud compute firewall-rules create reelody-web \
  --allow=tcp:80,tcp:443 --target-tags=http-server,https-server \
  --source-ranges=0.0.0.0/0 --description="Reelody public web"
```

Nothing opens 8000, 4001 or 27017. Ever. Use IAP for SSH rather than exposing 22:

```bash
gcloud compute ssh reelody --zone=asia-south1-a --tunnel-through-iap
```

A static address, so DNS and your OAuth origin don't move:

```bash
gcloud compute addresses create reelody-ip --region=asia-south1
ADDR=$(gcloud compute addresses describe reelody-ip --region=asia-south1 --format='value(address)')
gcloud compute instances delete-access-config reelody \
  --zone=asia-south1-a --access-config-name="external-nat"
gcloud compute instances add-access-config reelody \
  --zone=asia-south1-a --access-config-name="external-nat" --address="$ADDR"
```

Point an A record at `$ADDR`, then work through §4.

### 8.2 Disk snapshots

Cheap insurance, and independent of the `mongodump` in §14:

```bash
gcloud compute resource-policies create snapshot-schedule reelody-daily \
  --region=asia-south1 --max-retention-days=14 \
  --daily-schedule --start-time=20:00 --storage-location=asia-south1
gcloud compute disks add-resource-policies reelody \
  --zone=asia-south1-a --resource-policies=reelody-daily
```

### 8.3 The two systemd units

Note what is *not* here: `run.sh`. It installs packages, probes `mongosh`, builds if
needed and backgrounds the sidecar behind a shell trap — all useful on a laptop, all
wrong for something systemd is supposed to supervise and restart independently. Each
process gets its own unit.

```bash
sudo tee /etc/systemd/system/reelody-lyrics.service >/dev/null <<'EOF'
[Unit]
Description=Reelody lyrics sidecar
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=reelody
Group=reelody
# WorkingDirectory matters: the sidecar's config reads .env through dotenv, which
# resolves it against the working directory. Start it anywhere else and
# GEMINI_API_KEY is silently unset.
WorkingDirectory=/opt/reelody/app/lyrics-node
Environment=NODE_ENV=production
Environment=PORT=4001
Environment=CACHE_DIR=/opt/reelody/app/backend/lyrics-cache
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=3
# It binds loopback and has no auth of its own; give it nothing it doesn't need.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/reelody/app/backend/lyrics-cache

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/systemd/system/reelody-api.service >/dev/null <<'EOF'
[Unit]
Description=Reelody API
After=network-online.target mongod.service reelody-lyrics.service
Wants=network-online.target mongod.service

[Service]
Type=simple
User=reelody
Group=reelody
WorkingDirectory=/opt/reelody/app
Environment=HF_HOME=/opt/reelody/.cache/huggingface
Environment=INSTA_COOKIES_BROWSER=
# One worker. See constraint 1 — more than one breaks saves and doubles the
# download queue. No --reload either: that is a development convenience.
ExecStart=/opt/reelody/app/.venv/bin/uvicorn backend.main:app \
  --host 127.0.0.1 --port 8000 \
  --proxy-headers --forwarded-allow-ips=127.0.0.1
Restart=always
RestartSec=3
# Whisper on CPU is slow on purpose; don't let a watchdog kill it mid-transcription.
TimeoutStopSec=30
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now reelody-lyrics reelody-api
sudo systemctl status reelody-api --no-pager
```

Logs go to the journal, which is where you want them:

```bash
sudo journalctl -u reelody-api -f
sudo journalctl -u reelody-lyrics -n 100 --no-pager
```

Then §11 for the proxy and §12 for the smoke test.

### 8.4 If you were hoping for Cloud Run

See §3. The short version: it can be forced to work and it will cost you more than this
VM in both money and debugging. The VM is the right shape for a single-replica stateful
app with a loopback sidecar and a 1 GB model on disk.

---

## 9. AWS — EC2 + PM2

### 9.1 The instance

**Pick the instance type carefully.** `t3`-family instances are burstable, and Whisper
runs a core flat out for minutes at a time. On a default `t3.large` you will drain CPU
credits during file identification and the whole app — every page load, every stream —
gets throttled to baseline. Two acceptable answers:

- `t3.large` (2 vCPU / 8 GB) with **`CpuCredits=unlimited`**, and accept the surcharge
  when you burst; or
- `m7i-flex.large` / `m6i.large` (2 vCPU / 8 GB) for steady-state CPU and no credit
  arithmetic.

```bash
AMI=$(aws ec2 describe-images --owners 099720109477 \
  --filters 'Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*' \
            'Name=state,Values=available' \
  --query 'sort_by(Images,&CreationDate)[-1].ImageId' --output text)

aws ec2 run-instances \
  --image-id "$AMI" \
  --instance-type t3.large \
  --credit-specification CpuCredits=unlimited \
  --key-name my-keypair \
  --security-group-ids sg-xxxxxxxx \
  --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":30,"VolumeType":"gp3","DeleteOnTermination":false}}]' \
  --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=reelody}]'
```

`DeleteOnTermination: false` on the root volume is deliberate — your music is on it.

**Security group:** inbound `443` and `80` from `0.0.0.0/0`, and `22` from your own
address only. Better, attach an `AmazonSSMManagedInstanceCore` instance profile and open
no SSH at all (`aws ssm start-session --target i-...`). Outbound: all — the app needs
Instagram, YouTube, Google, HuggingFace, the lyrics sites and Gemini.

Allocate an Elastic IP and associate it, point DNS at it, then work through §4.

### 9.2 PM2

PM2 supervises both processes with one dashboard. It does not need to carry the secrets:
the backend parses `backend/.env` itself and the sidecar reads `lyrics-node/.env` through
dotenv, so PM2 only has to get the **working directory** and the handful of per-process
variables right.

```bash
sudo npm install -g pm2
```

Create `/opt/reelody/app/ecosystem.config.cjs`:

```js
// PM2 runs both Reelody processes in fork mode with one instance each.
// Cluster mode and `pm2 scale` are off the table: extract tokens and identify
// jobs live in process memory, and the ingest/lyrics workers start once per
// process. See docs/DEPLOYMENT.md §0.
module.exports = {
  apps: [
    {
      name: 'reelody-lyrics',
      // Must be the sidecar's own directory: its config reads .env through
      // dotenv, which resolves against the working directory.
      cwd: '/opt/reelody/app/lyrics-node',
      script: 'dist/index.js',
      exec_mode: 'fork',
      instances: 1,
      env: {
        NODE_ENV: 'production',
        // The sidecar's own default is 4000; the backend looks on 4001.
        PORT: '4001',
        // Absolute, so the caches land next to the rest of the app's data.
        CACHE_DIR: '/opt/reelody/app/backend/lyrics-cache',
      },
      max_restarts: 10,
      restart_delay: 3000,
    },
    {
      name: 'reelody-api',
      cwd: '/opt/reelody/app',
      // A binary, not a Node script — `interpreter: 'none'` stops PM2 trying
      // to run uvicorn through node.
      script: './.venv/bin/uvicorn',
      interpreter: 'none',
      args: [
        'backend.main:app',
        '--host', '127.0.0.1',
        '--port', '8000',
        '--proxy-headers',
        '--forwarded-allow-ips=127.0.0.1',
      ].join(' '),
      exec_mode: 'fork',
      instances: 1,
      env: {
        HF_HOME: '/opt/reelody/.cache/huggingface',
        // No browser profile exists on a server; cookies.txt does the job.
        INSTA_COOKIES_BROWSER: '',
      },
      // Whisper holds a lot briefly; don't let a memory cap recycle the process
      // in the middle of a transcription.
      max_memory_restart: '6G',
      kill_timeout: 30000,
      max_restarts: 10,
      restart_delay: 3000,
    },
  ],
};
```

Start it, survive reboots, and keep the logs from eating the disk:

```bash
cd /opt/reelody/app
sudo -u reelody pm2 start ecosystem.config.cjs
sudo -u reelody pm2 save

# Prints a command to run with sudo — run exactly what it prints.
sudo -u reelody pm2 startup systemd

sudo -u reelody pm2 install pm2-logrotate
sudo -u reelody pm2 set pm2-logrotate:max_size 10M
sudo -u reelody pm2 set pm2-logrotate:retain 7
sudo -u reelody pm2 set pm2-logrotate:compress true
```

Day to day:

```bash
pm2 ls                        # both processes, uptime, restarts, memory
pm2 logs reelody-api          # tail
pm2 logs reelody-lyrics --lines 100
pm2 restart reelody-api
pm2 monit
```

**Three PM2 rules for this app:**

1. `exec_mode: 'fork'`, `instances: 1`. Never `cluster`, never `pm2 scale reelody-api 2`.
   Cluster mode can't fork a non-Node script anyway, but `scale` will happily start a
   second uvicorn and break saves in a way that looks random.
2. `pm2 restart`, not `pm2 reload`. Reload's zero-downtime path is for clustered Node
   processes; here it's a restart either way, so don't expect graceful.
3. Check `pm2 ls` restart counts after a deploy. A process that's quietly crash-looping
   shows up there long before anyone reports it.

### 9.3 Backups to S3

Attach an instance profile allowing `s3:PutObject` on one bucket, then use the cron in
§14 with `aws s3 cp`. EBS snapshots (Data Lifecycle Manager, daily, 14 days) are the
second layer — the same role as GCP's snapshot schedule in §8.2.

---

## 10. Docker

Reproducible, and it moves between hosts. The constraints don't change: one API replica,
the sidecar unpublished, and real volumes for the things in §1's state table.

Nothing here is in the repo yet — create the three files under `deploy/`.

### 10.1 `deploy/Dockerfile.api`

```dockerfile
# syntax=docker/dockerfile:1

# ---- stage 1: build the SPA ------------------------------------------------
FROM node:22-slim AS ui
WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- stage 2: the API ------------------------------------------------------
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models \
    INSTA_COOKIES_BROWSER=""

# ffmpeg: yt-dlp's MP3 postprocessing, Shazam's decoder, the AcoustID PCM feed.
# libchromaprint1: pyacoustid calls the library directly, no fpcalc binary.
# libgomp1: ctranslate2, under faster-whisper.
# Each of those tiers is import-guarded, so a missing one is a silently weaker
# result rather than an error — which is exactly why they belong in the image.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg libchromaprint1 libgomp1 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt ./
RUN pip install -r requirements.txt

# Only the backend and the built SPA. app.py, static/, feature-code/ and
# identify.py are reference-only (see CLAUDE.md) and nothing in backend/
# imports them. BASE_DIR resolves to /app, so cookies.txt belongs at /app.
COPY backend/ ./backend/
COPY --from=ui /ui/dist ./frontend/dist

RUN mkdir -p /models backend/downloads backend/uploads backend/lyrics-cache

EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health',timeout=4).status==200 else 1)"

# 0.0.0.0 inside the container only — the published port is bound to the proxy,
# never to the world. Still exactly one worker.
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000", \
     "--proxy-headers", "--forwarded-allow-ips=*"]
```

Optional, if you'd rather pay ~1 GB of image size than wait on the first file
identification — bake the model in instead of mounting a volume for it:

```dockerfile
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('medium', device='cpu', compute_type='int8')"
```

### 10.2 `deploy/Dockerfile.lyrics`

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-slim AS build
WORKDIR /app
COPY lyrics-node/package.json lyrics-node/package-lock.json ./
RUN npm ci
COPY lyrics-node/tsconfig.json ./
COPY lyrics-node/src ./src
RUN npm run build

FROM node:22-slim
ENV NODE_ENV=production PORT=4001 CACHE_DIR=/cache
WORKDIR /app
COPY lyrics-node/package.json lyrics-node/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir -p /cache
# No EXPOSE and no published port: this service has no auth, no CORS and no
# ownership checks. The API is its only permitted caller.
CMD ["node", "dist/index.js"]
```

In a container there is no `lyrics-node/.env` — pass `GEMINI_API_KEY` as an environment
variable from Compose. dotenv finding nothing is harmless; dotenv finding nothing while
you believe it found something is the bug, and the symptom is lyrics with no explanation.

### 10.3 `deploy/docker-compose.yml`

```yaml
name: reelody

services:
  mongo:
    image: mongo:8
    restart: unless-stopped
    # No `ports:`. The API reaches it over the compose network.
    volumes:
      - mongo-data:/data/db
      - mongo-config:/data/configdb
    healthcheck:
      test: ["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 12

  lyrics:
    build:
      context: ..
      dockerfile: deploy/Dockerfile.lyrics
    restart: unless-stopped
    environment:
      PORT: "4001"
      CACHE_DIR: /cache
      GEMINI_API_KEY: ${GEMINI_API_KEY:-}
    volumes:
      # Found lyrics, paid-for explanations, Rekhta words. Losing it costs
      # money and time, not data — but there's no reason to lose it.
      - lyrics-cache:/cache

  api:
    build:
      context: ..
      dockerfile: deploy/Dockerfile.api
    restart: unless-stopped
    # Exactly one. Never `docker compose up --scale api=2`.
    depends_on:
      mongo: { condition: service_healthy }
      lyrics: { condition: service_started }
    environment:
      MONGO_URL: mongodb://mongo:27017
      DB_NAME: reel_audio
      LYRICS_SIDECAR_URL: http://lyrics:4001
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
      ADMIN_EMAILS: ${ADMIN_EMAILS}
      ALLOWED_EMAILS: ${ALLOWED_EMAILS:-}
      LEGACY_OWNER_EMAIL: ${ADMIN_EMAILS}
      SESSION_COOKIE_SECURE: "1"
      AUDIO_QUALITY: "192"
      ACOUSTID_API_KEY: ${ACOUSTID_API_KEY:-}
      HF_HOME: /models
    volumes:
      - whisper-models:/models
      # BASE_DIR is /app, so this is where config.py looks for it. `touch
      # cookies.txt` first or Docker creates a directory and extraction breaks.
      - ../cookies.txt:/app/cookies.txt:ro

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - api

volumes:
  mongo-data:
  mongo-config:
  whisper-models:
  lyrics-cache:
  caddy-data:
  caddy-config:
```

`deploy/Caddyfile`:

```
reelody.example.com {
	encode gzip

	# MAX_UPLOAD_BYTES is 64 MB; leave room for multipart overhead.
	request_body {
		max_size 72MB
	}

	reverse_proxy api:8000
}
```

And a `.env` beside the compose file for the interpolations (`.gitignore` already covers
any `.env`):

```bash
GOOGLE_CLIENT_ID=123-abc.apps.googleusercontent.com
ADMIN_EMAILS=you@example.com
ALLOWED_EMAILS=you@example.com
GEMINI_API_KEY=your-key
```

Bring it up:

```bash
cd deploy
touch ../cookies.txt          # before the first `up`, see the volume note
docker compose up -d --build
docker compose ps
docker compose logs -f api
```

### 10.4 Container gotchas specific to this app

- **Never scale `api`.** `--scale api=2` is constraint 1 with a friendly flag.
- **Never publish `lyrics`.** No `ports:`, and don't add a proxy route to it.
- **Never publish `mongo`.** If you must reach it from the host, use
  `docker compose exec mongo mongosh reel_audio`.
- **`--forwarded-allow-ips=*` is right here and wrong on a VM.** The proxy is another
  container with an address you don't control; the only thing that can reach the API port
  is the compose network. On a VM, keep it pinned to `127.0.0.1`.
- **Mongo's volume is your music.** `docker compose down -v` deletes the library. There
  is no undo. Back it up (§14) before you ever type that.
- **`backend/downloads` and `backend/uploads` stay inside the container** — they're
  pre-save scratch, and losing them on recreate costs at most an extraction nobody saved.
- **Image rebuild ≠ data loss, volume removal is.** Keep that distinction clear in
  whatever script you write around this.
- **`frontend/dist` is baked into the image.** A UI change needs a rebuild, not a restart.

---

## 11. The reverse proxy and TLS

You need https for three separate reasons: Google sign-in on a real domain, PWA
installation (and with it the Instagram share target), and not sending session cookies in
clear text.

### 11.1 nginx + certbot

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx
```

`/etc/nginx/sites-available/reelody`:

```nginx
server {
    listen 80;
    server_name reelody.example.com;

    # MAX_UPLOAD_BYTES is 64 MB (Add music -> From a file). Room for multipart.
    client_max_body_size 72m;

    # Audio and the pre-save preview are range-streamed out of GridFS by
    # backend/streaming.py so the player can seek. Buffering the response
    # defeats that; let it pass straight through.
    location ~ (^/api/preview/|/audio$) {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 300s;
    }

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        # POST /api/extract does its work in the request: yt-dlp, ffmpeg, a
        # Shazam lookup, a YouTube search. Tens of seconds, sometimes more.
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }
}
```

The regex location is matched before the prefix one, which is what you want — it covers
`/api/songs/{id}/audio`, `/api/shared/songs/{id}/audio`, `/api/identify/{job}/audio` and
`/api/preview/{token}`.

```bash
sudo ln -s /etc/nginx/sites-available/reelody /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d reelody.example.com
systemctl list-timers | grep certbot    # renewal is already scheduled
```

Certbot rewrites the block for TLS and adds the http→https redirect itself.

### 11.2 Caddy

Less to get wrong, and it handles certificates on its own. `/etc/caddy/Caddyfile`:

```
reelody.example.com {
	encode gzip
	request_body {
		max_size 72MB
	}
	reverse_proxy 127.0.0.1:8000
}
```

Caddy doesn't buffer responses by default, so range-streamed audio works without the
extra location block.

### 11.3 Cloudflare Tunnel

The right answer when the app runs on a machine at home: no inbound ports, no certificate
to manage, and — the reason it matters here — Instagram sees a residential IP.

```bash
cloudflared tunnel login
cloudflared tunnel create reelody
cloudflared tunnel route dns reelody reelody.example.com
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: <tunnel-uuid>
credentials-file: /home/you/.cloudflared/<tunnel-uuid>.json
ingress:
  - hostname: reelody.example.com
    service: http://127.0.0.1:8000
  - service: http_status:404
```

```bash
sudo cloudflared service install
sudo systemctl status cloudflared
```

**The 100-second rule.** Cloudflare terminates any request still open at ~100 s with a
524. The app is already built around that — share-sheet ingests and lyrics lookups go to
Mongo-backed queues with background workers precisely so nothing waits on a socket — but
`POST /api/extract` from the paste box does its work in the request. A long or slow reel
can hit the ceiling, and the fix is to retry or use the share sheet, not to raise a
timeout you don't control.

### 11.4 Rate limiting

The shared feed at `/` is public by design — no sign-in, and that includes the MP3 bytes
for anything in a public playlist. That's the deliberate alternative to a login wall, and
it means your instance has a public, unauthenticated surface that streams audio. Put a
rate limit in front of it: Cloudflare's rules if you're proxied, or nginx's
`limit_req_zone` on `/api/` if not.

---

## 12. Smoke test after the first deploy

In order. Each line tells you something the previous one didn't.

```bash
# 1. Both processes alive
systemctl is-active reelody-api reelody-lyrics   # or: pm2 ls / docker compose ps

# 2. The API answers, and tells you the Instagram cookie state
curl -s https://reelody.example.com/api/health
# {"ok":true,"storage":"gridfs","authenticated":true,"signed_in":false}

# 3. The sidecar is up — and NOT reachable from outside
curl -s 127.0.0.1:4001/api/health   # {"ok":true,"uptime":...}
# ...and NOT from anywhere else. Run this from another machine:
nc -z -w3 reelody.example.com 4001 && echo "EXPOSED — fix this now" || echo "closed, good"

# 4. Sign-in is configured
curl -s https://reelody.example.com/api/auth/config
# {"google_client_id":"123-abc.apps.googleusercontent.com","configured":true}

# 5. The SPA is really being served, not a JSON 404
curl -sI https://reelody.example.com/ | head -3
curl -sI https://reelody.example.com/songs | head -3   # deep link -> index.html
curl -sI https://reelody.example.com/manifest.webmanifest | grep -i content-type
# expect: application/manifest+json  (text/plain breaks "Install app")
```

Then open it in a browser and do the round trip by hand, because there's no test suite
that will do it for you:

- [ ] The page loads styled, and **refreshing on a nested route** (`/songs/<id>`) still
      loads — a blank page here means a `frontend/dist` or base-path problem.
- [ ] Sign in with Google works, and you're still signed in after a reload.
- [ ] Paste a reel URL → preview plays → YouTube matches appear → Save puts it in All
      songs.
- [ ] Play it, then **drag the seek bar** — that's the Range path through GridFS, and the
      first thing a buffering proxy breaks.
- [ ] Open the song → *Find lyrics* → words arrive, with a meaning if you set
      `GEMINI_API_KEY`.
- [ ] Add music → From a file → upload something and let it run (minutes, on CPU).
- [ ] Make a playlist public, open `/` in a private window, confirm it plays signed out.
- [ ] On Android Chrome: menu → **Install app**, then share a reel from Instagram to
      Reelody and watch it land in **Inbox**.
- [ ] Your admin link is present under your profile — if not, `ADMIN_EMAILS` is wrong.

---

## 13. Updating a running instance

```bash
cd /opt/reelody/app
sudo -u reelody git pull

sudo -u reelody ./.venv/bin/pip install -r requirements.txt
sudo -u reelody bash -c 'cd frontend && npm ci && npm run build'
sudo -u reelody bash -c 'cd lyrics-node && npm ci && npm run typecheck && npm run build'

sudo systemctl restart reelody-lyrics reelody-api
#   pm2 restart reelody-lyrics reelody-api
#   docker compose up -d --build
```

Both builds must come back clean before you restart anything. They are the only
verification this repo offers.

**Deploy when the Inbox is empty.** A restart is cheap but not free: in-flight extract
tokens and identify jobs die with the process (they're in memory by design), anything
`running` in the ingest queue is requeued at boot and starts over, and quota holds from
the work that died are refunded on startup. Nobody loses a song; somebody might have to
press a button again.

**Update `yt-dlp` on its own cadence.** Instagram changes, and a stale yt-dlp is the most
common cause of extraction that worked last month and doesn't today:

```bash
sudo -u reelody ./.venv/bin/pip install -U yt-dlp && sudo systemctl restart reelody-api
```

**When iterating on lyrics**, the sidecar caches results for 6 hours — append `&refresh=1`
or you'll be looking at the old answer and blaming your change.

---

## 14. Backups and restore

Your library is a MongoDB database that happens to contain audio. Back up the database.

```bash
sudo mkdir -p /var/backups/reelody && sudo chown reelody /var/backups/reelody

sudo -u reelody mongodump --uri="mongodb://127.0.0.1:27017" --db=reel_audio \
  --gzip --archive="/var/backups/reelody/reel_audio-$(date +%F).gz"
```

GridFS is in there, so the archive is roughly the size of your music. Nightly, with
off-box copies and a two-week window:

```bash
sudo tee /etc/cron.daily/reelody-backup >/dev/null <<'EOF'
#!/bin/sh
set -e
OUT="/var/backups/reelody/reel_audio-$(date +%F).gz"
su -s /bin/sh reelody -c "mongodump --uri='mongodb://127.0.0.1:27017' --db=reel_audio --gzip --archive='$OUT'"
# GCS:  gsutil cp "$OUT" gs://your-bucket/reelody/
# S3:   aws s3 cp "$OUT" s3://your-bucket/reelody/
find /var/backups/reelody -name 'reel_audio-*.gz' -mtime +14 -delete
EOF
sudo chmod +x /etc/cron.daily/reelody-backup
```

Restore:

```bash
sudo -u reelody mongorestore --uri="mongodb://127.0.0.1:27017" \
  --gzip --archive=/var/backups/reelody/reel_audio-2026-10-05.gz \
  --nsInclude='reel_audio.*' --drop
```

In Compose: `docker compose exec -T mongo mongodump --db=reel_audio --gzip --archive`
into a file on the host, and the mirror image to restore.

**Don't bother backing up** `backend/lyrics-cache/` (rebuilds itself, costing money and
time rather than data), `backend/downloads/` and `backend/uploads/` (scratch), or the
Whisper model (re-downloads). Disk snapshots (§8.2, §9.3) are the second layer, not the
first: they're a point-in-time copy of a running database, which is usually fine for a
single node and never as trustworthy as a `mongodump`.

**Test a restore once**, into a throwaway `DB_NAME`, before you need one.

---

## 15. Hardening checklist

- [ ] **Nothing but 80/443 is reachable.** Verify from off-box, don't infer it from the
      config: `nmap -Pn your.host` should show two ports.
- [ ] **`:4001` is loopback or container-internal.** It has no auth, no CORS, no quota —
      exposing it hands out your Gemini key.
- [ ] **`:8000` is loopback too.** The proxy is the only thing that talks to it.
- [ ] **Mongo is `bindIp: 127.0.0.1`** (or unpublished in Compose). If it ever has to
      cross a network, enable auth and TLS first.
- [ ] **`ADMIN_EMAILS` is your address.** The default is the author's.
- [ ] **`ALLOWED_EMAILS` is set**, unless you genuinely want any Google account to get a
      library and a share of your quota.
- [ ] **`LEGACY_OWNER_EMAIL` is set** on an instance with pre-login rows, or the first
      stranger to sign in adopts them.
- [ ] **`SESSION_COOKIE_SECURE=1`** behind https.
- [ ] **`chmod 600`** on `backend/.env`, `lyrics-node/.env` and `cookies.txt`; all three
      are gitignored, keep them that way.
- [ ] **A rate limit on `/api/`** — the shared feed is deliberately public.
- [ ] **Unattended upgrades on**, and `ufw` with 22 (or nothing, via IAP/SSM) + 80 + 443.
- [ ] **The app runs as an unprivileged user**, not root and not your login.
- [ ] **One worker.** Check it after every deploy: `pgrep -af uvicorn` should print one
      line.

A note that isn't technical: a public deployment widens the rights question the README
raises. Commercial music on Instagram belongs to its rights holders, lyrics belong to
their publishers, and an instance strangers can sign into is a different proposition from
one on your own machine. `ALLOWED_EMAILS` is the control for that.

---

## 16. Operating it

**Logs.** `journalctl -u reelody-api -f`, `pm2 logs reelody-api`, or
`docker compose logs -f api`. The API logs the ingest worker's progress, which is where
you look when the Inbox says Failed.

**Health.** Poll `/api/health` every few minutes. It tells you two different things:
`ok` (the process is up and Mongo answered) and `authenticated` (the Instagram cookie
session is still good). The second one is the early warning for expired cookies — nothing
else tells you until an extraction fails.

```bash
curl -fsS https://reelody.example.com/api/health | grep -q '"authenticated":true' \
  || echo "Instagram cookies need re-exporting"
```

**Disk.** The thing that will actually bite you. Watch both the filesystem and the
database:

```bash
df -h /
mongosh reel_audio --quiet --eval 'JSON.stringify(db.stats(1024*1024))'   # MB
mongosh reel_audio --quiet --eval 'db.songs.countDocuments()'
```

Alarm at 75%, not 95% — WiredTiger does not enjoy a full disk, and GridFS growth is
monotonic unless somebody deletes songs.

**The queues**, when something looks stuck:

```bash
mongosh reel_audio --quiet --eval 'db.ingest_jobs.find({state:{$in:["queued","running"]}}).pretty()'
mongosh reel_audio --quiet --eval 'db.lyrics.find({state:"running"}).pretty()'
mongosh reel_audio --quiet --eval 'db.quota_holds.countDocuments()'
```

Anything stuck `running` with no process behind it is cleared by a restart — stale rows
are requeued and orphaned quota holds refunded in `on_startup`.

---

## 17. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Blank page, console says a module script was refused | `frontend/dist` missing or stale, so the SPA shell is being served where an asset was expected | `cd frontend && npm run build`, restart the API |
| Every route returns `{"error":"No such endpoint."}` | no `frontend/dist`, so the catch-all route was never registered | same |
| Deep link works, refresh gives 404 | you changed Vite's `base` away from `/` | put it back — see the comment in `frontend/vite.config.js` |
| Sign-in button does nothing | the origin isn't in **Authorised JavaScript origins**, exactly, scheme included | §6. `127.0.0.1` ≠ `localhost` ≠ your domain |
| Signs in, signed out on reload | `SESSION_COOKIE_SECURE=1` while serving plain http — the browser drops the cookie | turn it off, or finish setting up https |
| Saving an extraction fails with an unknown token | more than one API worker | one worker. §0 |
| Two reels downloading at once | more than one API process | same |
| `Future attached to a different loop`, uvicorn won't boot | a module grabbed a collection at import time | reach collections as `db.songs_col` at request time; `db.connect()` runs in the startup event |
| Lyrics lookups 502 | sidecar down, or **`PORT` mismatch** — its own default is 4000, the backend looks on 4001 | `PORT=4001`, or set `LYRICS_SIDECAR_URL` to match |
| Lyrics arrive, no meaning | `GEMINI_API_KEY` never reached the sidecar — dotenv resolves `.env` against the working directory | start it from `lyrics-node/`, or pass the key as an env var in Compose |
| Lyrics change doesn't show | the sidecar's 6-hour result cache | append `&refresh=1` |
| Reels fail: "login required" | no Instagram cookies, or they expired | `/api/health` → `authenticated`; re-export `cookies.txt` (§7) |
| Reels fail from a cloud IP with fresh cookies | Instagram declining the datacenter range | pace it, or run at home behind a tunnel (§11.3) |
| File identify: "no match found" for something obvious | an import-guarded tier missing silently — `faster-whisper`, `libchromaprint1`, or no `ACOUSTID_API_KEY` | compare installed packages between the box that works and the one that doesn't |
| First file identify takes forever | the ~1 GB Whisper download | pre-warm it (§4.7) |
| 413 on upload | proxy body limit below `MAX_UPLOAD_BYTES` (64 MB) | `client_max_body_size 72m` / Caddy `request_body` |
| Audio plays but won't seek | a proxy buffering the response or dropping `Range` | `proxy_buffering off` on the audio locations (§11.1) |
| 524 at about 100 seconds | Cloudflare's request ceiling, not yours | retry, or use the share sheet — the queued path exists for this |
| Whole app crawls during a file identify | burstable instance out of CPU credits | `CpuCredits=unlimited` or a non-burstable type (§9.1) |
| mongod killed, app dead | OOM killer chose between Whisper and Mongo | add swap (§2) or move to 8 GB |
| "Install app" missing on Android | not https, no service worker, or the manifest served as `text/plain` | check `/manifest.webmanifest`'s content type |
| Share from Instagram does nothing | app not installed from the home screen, or the server was asleep when you shared — nothing retries | reinstall; keep the host awake |

---

## 18. The short list of things not to do

1. Don't run more than one API worker. Not `--workers`, not `pm2 scale`, not
   `--scale api=2`.
2. Don't expose `:4001`. Or `:8000`. Or `:27017`.
3. Don't use `run.sh` as a service supervisor.
4. Don't put the library on a free 512 MB database tier — the audio lives in it.
5. Don't run `docker compose down -v` without a fresh `mongodump`.
6. Don't deploy without `npm run build` and `npm run typecheck` coming back clean.
7. Don't add a test framework or a linter config to make this easier to verify, unless
   you were asked to.
