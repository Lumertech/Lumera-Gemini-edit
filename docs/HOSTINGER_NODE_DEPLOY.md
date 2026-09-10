# Hostinger Node deploy — www.mylumera.in

**Status:** this document is the production runbook. It does **not** mean the site is live. Hostinger credentials were not available when this was written. The founder must grant hPanel (Node.js Web App) or SSH access before anyone can complete issue #26 acceptance.

**App:** Node Express + Vite SPA (`npm run build` then `npm start`). This is **not** a Firebase / static-only host. Do not point the domain at AI Studio publish or Firebase domain-forward.

**Canonical public origin:** `https://www.mylumera.in`  
**Honesty:** Lumera is **not** a certified Meta Tech Provider. Do not paste Dashboard URLs until the smoke curls below return HTTPS 200.

---

## 1. Hostinger panel settings (copy exactly)

hPanel → **Websites → Add Website → Node.js web app** → import GitHub `Lumertech/Lumera-Gemini-edit` (or the branch you merge to `main`).

If the domain is already attached as a PHP / static / forward site, **remove that website slot first**. Hostinger’s Node flow expects a fresh slot. Do **not** leave Gemini/Firebase forwarding in front of this app.

| Field | Value | Why |
| --- | --- | --- |
| Framework preset | **Express** (or Other). **Not** Vite / React static | Auto-detect may pick Vite because of `vite.config.ts`. A static `dist` deploy would 200 the landing HTML and **break** `/api/*` (OAuth, webhook, policies JSON). |
| Branch | `main` (after this PR merges) | |
| Node.js version | **22** | `package.json` `engines.node` is `>=22 <25`. The app uses Node’s built-in `node:sqlite` (not available as used here on 18/20). Hostinger default is 22. |
| Package manager | **npm** | |
| Root directory | `/` (empty) | `package.json` is at repo root. |
| Build command | `npm run build` | Vite client → `dist/` + bundled `dist/server.cjs`. |
| Start command | `npm start` | Sets `NODE_ENV=production` and runs `node dist/server.cjs`. |
| Output directory | `dist` | Compiled server + client assets. |
| Entry file | `dist/server.cjs` | **Required.** Must end in `.cjs`. If you leave this empty, Hostinger treats the app as a static frontend. |
| Public directory | **none / leave empty** | Express serves `dist`. Do not map a static public folder in front of Node. |

Machine-readable copy of the same values: [`deploy/hostinger-webapp.settings.json`](../deploy/hostinger-webapp.settings.json).

VPS / SSH alternative (not the hPanel Web App flow): `npm run build` then `pm2 start ecosystem.config.cjs`. Still set the env vars below.

---

## 2. Required environment variables

Set in hPanel **Environment variables** (or import a `.env` there). Never commit secrets.

### Required for hosting / App Review **URL** stage

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_URL` | `https://www.mylumera.in` (no trailing slash) |
| `JWT_SECRET` | long random string (no `change-me` / placeholder). Auth **fails closed** without it; production **refuses to start** if it is missing or a placeholder. |

`PORT` is injected by Hostinger. The server binds `process.env.PORT` (fallback `3000`). Do not hardcode a panel PORT unless Hostinger’s runtime logs say the process bound the wrong port.

### Optional until the founder provisions Meta / payments

Leave unset for the URL-hosting stage. Production **does not fake** Graph delivery or Facebook Login without these.

| Variable | Needed when |
| --- | --- |
| `META_VERIFY_TOKEN` | Meta can verify `GET /api/meta/webhook` |
| `META_APP_SECRET` | Webhook HMAC (`X-Hub-Signature-256`) in production |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | Live Facebook Login |
| `FACEBOOK_REDIRECT_URI` | Override; default is `{APP_URL}/api/auth/facebook/callback` |
| `META_ACCESS_TOKEN` / `META_PHONE_NUMBER_ID` | Live Graph send |
| `GEMINI_API_KEY` | Pulse AI / SOAP (landing + policy pages work without it) |
| Razorpay keys | Payments — not required to host Review URLs |

---

## 3. DNS

| Host | Target |
| --- | --- |
| `www.mylumera.in` | Hostinger **Node.js Web App** (this Express process) + Hostinger SSL |
| `mylumera.in` (apex) | **301 redirect → `https://www.mylumera.in`** (Hostinger redirect / domain aliases). Register the apex in Meta App Domains only if you actually serve it. |

Stop any existing forward to Firebase (`gen-lang-client-0108182367`) or AI Studio publish. Meta reviewers must hit Node, not a static 404/500 forward.

TLS: use Hostinger’s SSL for `www`. Do not submit App Review on HTTP.

---

## 4. Health / smoke (must 200 without login)

After deploy, from any laptop:

```bash
for p in / /privacy-policy /terms-of-service /data-deletion-instructions; do
  echo "== $p"
  curl -sI "https://www.mylumera.in$p" | head -n 1
done

curl -sI "https://www.mylumera.in/healthz" | head -n 1
curl -sI "https://www.mylumera.in/api/public/policies/privacy-policy" | head -n 1
curl -sI "https://www.mylumera.in/api/meta/webhook"
```

Expect:

- `/`, `/privacy-policy`, `/terms-of-service`, `/data-deletion-instructions` → **HTTP 200** (SPA `index.html`; no login wall).
- `/healthz` → **200** `ok`.
- `/api/public/policies/privacy-policy` → **200** JSON (CMS body, including WhatsApp STOP opt-out).
- `GET /api/meta/webhook` without hub params → **403/500** until `META_VERIFY_TOKEN` is set. It must still be **reachable over HTTPS** (not DNS/Firebase 404).

**Do not paste these URLs into Meta App Dashboard until the four document paths return HTTPS 200.**

Local production smoke (same process Hostinger runs):

```bash
export NODE_ENV=production
export JWT_SECRET=local-smoke-secret-not-for-prod
export APP_URL=http://127.0.0.1:3000
export PORT=3000
npm run build
npm start
# in another terminal:
for p in / /privacy-policy /terms-of-service /data-deletion-instructions; do
  curl -sI "http://127.0.0.1:3000$p" | head -n 1
done
```

SQLite file is `data/lumera.db` under the process cwd. Hostinger rebuilds may replace the app directory — policy text is re-seeded on boot, but **clinic data is not durable** across deploys unless you persist `data/` (out of scope for the URL stage).

---

## 5. Meta App Dashboard URL checklist (sandbox-honest)

Canonical host: **`https://www.mylumera.in`**. Set `APP_URL` to that origin. Prefer apex → 301 → www.

**Do not claim:** certified Meta Tech Provider, App Review approved/submitted, live WhatsApp Cloud send, or HIPAA.

Paste **only after** the smoke gate in §4 is green:

| Meta Dashboard field | URL |
| --- | --- |
| App domains | `www.mylumera.in` (also apex if it 301s or serves) |
| Site URL (Facebook Login) | `https://www.mylumera.in/` |
| Privacy Policy URL | `https://www.mylumera.in/privacy-policy` |
| Terms of Service URL | `https://www.mylumera.in/terms-of-service` |
| User data deletion instructions (human page) | `https://www.mylumera.in/data-deletion-instructions` |
| Data deletion request callback | `https://www.mylumera.in/api/meta/data-deletion` (`POST`) |
| Valid OAuth Redirect URIs (Facebook Login) | `https://www.mylumera.in/api/auth/facebook/callback` |
| WhatsApp webhook callback URL | `https://www.mylumera.in/api/meta/webhook` (`GET` challenge + `POST`) |

Optional override: `FACEBOOK_REDIRECT_URI=https://www.mylumera.in/api/auth/facebook/callback`.

### Must be real before Review submission

Hosting + TLS, Privacy, Terms, data-deletion page + callback, OAuth redirect URI registered, webhook verify + HMAC once Meta secrets exist, honest DPDP / WhatsApp Cloud API copy (**not** HIPAA / certified Tech Provider).

### May stay SANDBOX until credentials + Review clear

Graph OTP / reminder / receipt without tokens; `simulate-embedded-signup`; unsigned webhook (non-prod only — production rejects unsigned); in-product `NOT_SUBMITTED` / “building toward Meta Tech Provider”.

---

## 6. Founder access blocker

This repo change cannot finish issue #26 acceptance. Ask the founder for:

1. hPanel login **or** a collaborator seat on the Hostinger account that owns `mylumera.in`.
2. Permission to create a **Node.js Web App** (Business Web Hosting or Cloud plan — see Hostinger’s Node.js requirements) and to **remove** the current Firebase/static forward.
3. GitHub access so Hostinger can clone `Lumertech/Lumera-Gemini-edit`.
4. DNS permission: www → Node app; apex 301 → www; SSL on www.
5. Values to paste as env: `APP_URL=https://www.mylumera.in`, a new `JWT_SECRET`, `NODE_ENV=production`.
6. After public 200s: who pastes the Dashboard table in §5 (founder / Meta owner).

Until those exist, treat www as **not live** even if this PR is merged.

---

## 7. Troubleshooting (Hostinger)

| Symptom | Likely cause |
| --- | --- |
| Build green, site 404/static only, `/api` missing | Framework detected as Vite; **entry file empty**. Set Express + `dist/server.cjs`. |
| Process crash on boot | Missing `JWT_SECRET`, or Node 18/20 (`node:sqlite`). Check Runtime Logs. |
| App not responding | Bound wrong port — confirm Hostinger injects `PORT` and the process logs `Lumera AI Server running on http://0.0.0.0:<port>`. |
| 403 after redeploy | Stale `public_html/.htaccess`. Redeploy; do not hand-edit (Hostinger regenerates it). |
| Policy URL 404 | SPA fallback not running (static host) or path typo. Confirm Express is the process. |
| Webhook GET 500 | Expected until `META_VERIFY_TOKEN` is set. |
| `www` still 404/500 | DNS still on Firebase forward. |
