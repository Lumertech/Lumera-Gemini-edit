# Firebase Hosting + Cloud Run — www.mylumera.in

**Status:** this document is the production runbook. It does **not** mean `www.mylumera.in` is live. Cloud Run service **`lumera-gemini-edit`** in **`asia-south1`** was discovered in Firebase Console. Remaining: Hosting may still need **Get started** in Console, connect custom domain **`www.mylumera.in`**, deploy the Hosting rewrite, and wait for SSL cert mint. DNS already points at Firebase (`A 199.36.158.100`).

**Architecture (locked):**

```
Firebase Hosting (custom domain www.mylumera.in)
        └── rewrite **  →  Cloud Run
                              └── Express + Vite (`npm run build` → `dist/server.cjs`, `npm start`)
```

Gemini AI Studio **Publish** may produce the Cloud Run service. Firebase Hosting is the www front door. DNS for `www.mylumera.in` already points at Firebase Hosting (`A 199.36.158.100`). **Keep that DNS. Do not buy Hostinger. Do not remove Firebase DNS.**

Today’s live symptom (2026-09-10): www TLS presents `CN=firebaseapp.com` (SAN mismatch) and apex `mylumera.in` is 404. That is an unfinished Hosting custom-domain / cert mint, not a reason to change nameservers.

**Canonical public origin:** `https://www.mylumera.in`  
**Honesty:** Lumera is **not** a certified Meta Tech Provider. Do not paste Dashboard URLs until the smoke curls below return HTTPS 200.

Firebase project (from `firebase-applet-config.json` / `.firebaserc`): **`gen-lang-client-0108182367`**.

---

## 1. Build / start (same process Cloud Run runs)

| Item | Value |
| --- | --- |
| Node.js | **22** (`package.json` `engines.node` is `>=22 <25`). Built-in `node:sqlite` — not 18/20. |
| Build | `npm run build` — Vite client → `dist/` + bundled `dist/server.cjs` |
| Start | `npm start` → `NODE_ENV=production node dist/server.cjs` |
| Port | Honor `process.env.PORT` (Cloud Run injects this; this AI Studio service uses `3000`. Dockerfile `ENV PORT=8080` is only the unset default.) |
| Public directory on Hosting | `hosting/` is an empty stub (no `index.html`) so `/` is **not** served as static Firebase. The Node process serves `dist`. |

Do **not** deploy Vite `dist/` as a static Hosting site. That would 200 the landing HTML and **break** `/api/*` (OAuth, webhook, policy JSON).

---

## 2. Cloud Run (canonical: image via `cloudbuild.yaml`)

**Canonical path going forward:** build the repo `Dockerfile` and `gcloud run deploy --image` from root `cloudbuild.yaml`. Do **not** mix AI Studio Publish / `gcloud run deploy --source` with that image pipeline on the same service unless you first clear `run.googleapis.com/sources` (see §2b).

### Path A — Gemini AI Studio Publish (do not mix with image Cloud Build)

1. Publish this repo from AI Studio so Google builds and runs the Node app on Cloud Run.
2. Live service (Firebase Console): **`lumera-gemini-edit`** in **`asia-south1`**.
3. `firebase.json` already pins those values (`hosting.rewrites[0].run.serviceId` / `region`). Redeploy Hosting after Publish if the service was recreated.
4. Cloud Run **ingress**: allow traffic from Firebase Hosting / public (Hosting rewrite needs to reach the service).
5. If you later switch to Cloud Build image deploys, clear the source annotation first (§2b). Do not run AI Studio Publish and `cloudbuild.yaml` against the same revision stream without that clear.

### Path B — Container from this repo (manual; same contract as `cloudbuild.yaml`)

```bash
export PROJECT=gen-lang-client-0108182367
export REGION=asia-south1
export SERVICE=lumera-gemini-edit

gcloud builds submit --tag "gcr.io/${PROJECT}/${SERVICE}" --project "${PROJECT}"
gcloud run deploy "${SERVICE}" \
  --image "gcr.io/${PROJECT}/${SERVICE}" \
  --region "${REGION}" \
  --project "${PROJECT}" \
  --allow-unauthenticated \
  --set-env-vars "NODE_ENV=production,APP_URL=https://www.mylumera.in" \
  --set-secrets "JWT_SECRET=JWT_SECRET:latest"
```

Use Secret Manager (or AI Studio secrets) for `JWT_SECRET`. Never commit it. Prefer `--update-env-vars` / existing revision secrets so you do not wipe `META_VERIFY_TOKEN`.

`Dockerfile` is Node 22, `npm ci` when `package-lock.json` exists otherwise `npm install`, `npm run build`, `npm start`, `USER node`, honors `PORT`.

SQLite is `data/lumera.db` under the process cwd. Cloud Run instances are ephemeral — policy text **re-seeds on boot**. Durable clinic data is out of scope for the App Review URL stage.

### Path C — Cloud Build trigger → repo `cloudbuild.yaml` (preferred)

Root `cloudbuild.yaml` builds the Dockerfile, pushes `${_IMAGE}`, clears leftover source metadata, then deploys **that image only** (no `--source`).

| Substitution | Default | Meaning |
| --- | --- | --- |
| `_SERVICE` | `lumera-gemini-edit` | Cloud Run service name |
| `_REGION` | `asia-south1` | Must match `firebase.json` Hosting rewrite |
| `_IMAGE` | `gcr.io/${PROJECT_ID}/lumera-gemini-edit:${SHORT_SHA}` | Image URI Cloud Run pulls |

Wire / retarget the Console trigger:

1. Cloud Build → Triggers → the trigger that deploys this repo (or Create trigger).
2. Event: push to `main` (or your release branch).
3. Configuration: **Cloud Build configuration file**, location **`/cloudbuild.yaml`** (repo root). Do not leave it on the Console-generated Dockerfile/Buildpacks template — that path never clears the annotation.
4. Optional substitution overrides: `_SERVICE`, `_REGION`, `_IMAGE` (use Artifact Registry if you already have `asia-south1-docker.pkg.dev/${PROJECT}/…`).
5. Cloud Build SA needs Cloud Run Admin, Service Account User (act-as the Cloud Run runtime SA), and push to the image registry.

Every revision still needs (set once in Console / Secret Manager; the pipeline pins only the public two via `--update-env-vars`):

| Variable | Value |
| --- | --- |
| `APP_URL` | `https://www.mylumera.in` |
| `NODE_ENV` | `production` |
| `JWT_SECRET` | long random; production **exits before listen** on missing/placeholder. Cloud Run then reports a PORT timeout — that is not a bind bug. See `deploy/CLOUD_RUN_BOOT_CHECK.md`. |
| `META_VERIFY_TOKEN` | required before Meta can verify `GET /api/meta/webhook` |

---

## 2b. Unblock: AI Studio source annotation vs image Cloud Build

**Symptom**

```
ERROR: (gcloud.run.deploy) spec.template.metadata.annotations[run.googleapis.com/sources]: Source annotation has sources that are not referenced by a container.
```

**Cause.** Service `lumera-gemini-edit` (`asia-south1`, project `gen-lang-client-0108182367`) was first published via AI Studio / `gcloud run deploy --source`. That writes `run.googleapis.com/sources` on the revision template (often with `image: scratch`). A later **image-only** Cloud Build copies that annotation onto a container that does not reference those sources, and the API rejects the revision. Do **not** delete the Cloud Run service to fix this.

**One-time Console / gcloud unblock (CoS):** do **not** run
`gcloud run services update --remove-annotations=run.googleapis.com/sources`.
That flag is not on the Cloud SDK CLI (`unrecognized arguments`; it suggests
`--remove-env-vars`). After an image exists:

```bash
export PROJECT=gen-lang-client-0108182367
export REGION=asia-south1
export SERVICE=lumera-gemini-edit
# IMAGE = the URI you just pushed (same as ${_IMAGE} in cloudbuild.yaml)
deploy/clear-cloud-run-source-annotation.sh \
  --service="${SERVICE}" --region="${REGION}" --project="${PROJECT}" \
  --image="${IMAGE}"
```

That is `describe --format=export` → drop `run.googleapis.com/sources` and
`run.googleapis.com/base-images` → delete `runtimeClassName:
run.googleapis.com/linux-base-image-update` → rewrite `scratch` →
`gcloud run services replace`. Env vars and unrelated annotations
(autoscaling, etc.) are preserved. Then `gcloud run deploy --image` succeeds.

`cloudbuild.yaml` step `clear-source-annotation` runs the same helper before
the image deploy. Retry Cloud Build with the trigger pointed at repo
`cloudbuild.yaml`.

**Going forward:** image via `cloudbuild.yaml` only. Avoid mixing AI Studio Publish with Cloud Build image deploys without clearing the annotation first.

---

## 3. Required Cloud Run environment

### Required for hosting / App Review **URL** stage

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_URL` | `https://www.mylumera.in` (no trailing slash) |
| `JWT_SECRET` | long random string (no `change-me` / placeholder). Production **exits before listen** if missing or a placeholder. Cloud Run will then say the revision did not listen on PORT. |

`PORT` is injected by Cloud Run (this service: `3000`). `resolveListenPort()` honors it. Do not hardcode `8080` for listen. Dockerfile `ENV PORT=8080` is a default only when unset.

Boot order and the JWT vs PORT confusion: `deploy/CLOUD_RUN_BOOT_CHECK.md`.

### Optional until the founder provisions Meta / payments

Leave unset for the URL-hosting stage. Production **does not fake** Graph delivery, Facebook Login, or Razorpay capture without these.

| Variable | Needed when |
| --- | --- |
| `META_VERIFY_TOKEN` | Meta can verify `GET /api/meta/webhook` |
| `META_APP_SECRET` | Webhook HMAC (`X-Hub-Signature-256`) in production |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET` | Live Facebook Login |
| `FACEBOOK_REDIRECT_URI` | Override; default is `{APP_URL}/api/auth/facebook/callback` |
| `META_ACCESS_TOKEN` / `META_PHONE_NUMBER_ID` | Live Graph send |
| `GEMINI_API_KEY` | Pulse AI / SOAP (landing + policy pages work without it; AI Studio often injects this) |
| Razorpay keys | Payments — not required to host Review URLs |

---

## 4. Firebase Hosting rewrite + custom domain

Repo files:

- `.firebaserc` — default project `gen-lang-client-0108182367`
- `firebase.json` — rewrite `**` → Cloud Run **`lumera-gemini-edit`** in **`asia-south1`**
- `hosting/` — empty public root so Hosting does not shadow `/`

Hosting site + custom domain (www is **not** live until these are done):

1. Firebase Console → Hosting: if the site still shows **Get started**, complete that first (the Hosting site may not exist yet).
2. `firebase deploy --only hosting --project gen-lang-client-0108182367` (rewrites `**` to `lumera-gemini-edit` / `asia-south1`).
3. Connect custom domain **`www.mylumera.in`**. DNS **already** has the Firebase Hosting A record (`199.36.158.100`) — do not point it elsewhere. Wait for Google to mint a cert whose SAN includes `www.mylumera.in` (today it is still `firebaseapp.com`).
4. Optional: apex `mylumera.in` as a Firebase **redirect** to `https://www.mylumera.in` (301). Keep www as the canonical host.

Hosting rewrite regions must be one of [Firebase’s Cloud Run rewrite regions](https://firebase.google.com/docs/hosting/cloud-run). The live service is **`asia-south1`**.

---

## 5. Health / smoke (must 200 without login)

After rewrite + cert mint, from any laptop:

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

- `/` → **HTTP 200** (SPA landing; no login wall).
- `/privacy-policy`, `/terms-of-service`, `/data-deletion-instructions` → **HTTP 200** HTML that **embeds the `cms_policies` body** (title + article). Meta crawlers must see “not a certified Meta Tech Provider” and WhatsApp **STOP** in the document, not an empty SPA shell.
- `/healthz` → **200** `ok`.
- `/api/public/policies/privacy-policy` → **200** JSON (same honest CMS body, including WhatsApp STOP opt-out).
- `GET /api/meta/webhook` without hub params → **403/500** until `META_VERIFY_TOKEN` is set. It must still be **reachable over HTTPS** (not a Firebase static 404 / cert mismatch).
- `GET /api/meta/data-deletion-status?code=DEL-TEST` must **not** return `COMPLETED` for an unknown code.

After a policy-seed merge, **Cloud Run must redeploy (or restart)** so live www picks up the force-upserted `cms_policies` rows. Production must set `APP_URL=https://www.mylumera.in` so deletion confirmation `url` values are not the `*.run.app` host.

**Do not claim Dashboard-ready** until Compliance re-skims the live HTML.

**Do not paste these URLs into Meta App Dashboard until the four document paths return HTTPS 200 with a cert for www.mylumera.in.**

Local production smoke (same process Cloud Run runs):

```bash
export NODE_ENV=production
export JWT_SECRET=local-smoke-secret-not-for-prod
export APP_URL=http://127.0.0.1:8080
export PORT=8080
npm run build
npm start
# in another terminal:
for p in / /privacy-policy /terms-of-service /data-deletion-instructions; do
  curl -sI "http://127.0.0.1:8080$p" | head -n 1
done
```

---

## 6. Meta App Dashboard URL checklist (sandbox-honest)

Canonical host: **`https://www.mylumera.in`**. Set `APP_URL` to that origin.

**Do not claim:** certified Meta Tech Provider, App Review approved/submitted, live WhatsApp Cloud send, or HIPAA.

Paste **only after** the smoke gate in §5 is green:

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

Hosting + TLS on www, Privacy, Terms, data-deletion page + callback, OAuth redirect URI registered, webhook verify + HMAC once Meta secrets exist, honest DPDP / WhatsApp Cloud API copy (**not** HIPAA / certified Tech Provider).

### May stay SANDBOX until credentials + Review clear

Graph OTP / reminder / receipt without tokens; `simulate-embedded-signup`; unsigned webhook (non-prod only — production rejects unsigned); in-product `NOT_SUBMITTED` / “building toward Meta Tech Provider”.

---

## 7. Founder access blocker

This repo change cannot finish issue #26 acceptance. Ask the founder / GCP owner for:

1. Permission to deploy / update Cloud Run on `gen-lang-client-0108182367` (`cloudbuild.yaml` image deploy **or** AI Studio Publish, not both without §2b) for service **`lumera-gemini-edit`** in **`asia-south1`**. Point the Cloud Build trigger at `/cloudbuild.yaml`.
2. Cloud Run env: `APP_URL=https://www.mylumera.in`, a new `JWT_SECRET`, `NODE_ENV=production`, plus `META_VERIFY_TOKEN` before Meta webhook verify.
3. If Hosting still shows **Get started**, finish that in Console, then `firebase deploy --only hosting` (`firebase.json` already pins `lumera-gemini-edit` / `asia-south1`).
4. Connect custom domain **`www.mylumera.in`** and wait until the cert SAN includes it (keep existing A `199.36.158.100`).
5. Optional apex 301 → www in Firebase Hosting.
6. After public HTTPS 200s: who pastes the Dashboard table in §6 (founder / Meta owner).

Until those exist, treat www as **not live** even if this PR is merged.

---

## 8. Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| TLS `CN=firebaseapp.com`, curl 60 | Custom domain connected but cert not minted yet. Keep Firebase DNS; wait / finish Hosting domain setup. |
| www or `*.web.app` serves static 404 / AI Studio placeholder | Hosting rewrite not deployed, or `public` still has an `index.html`. Confirm `**` → Cloud Run and empty `hosting/`. |
| `/` 200 HTML but `/api/*` 404 | Hosting is serving Vite static instead of Cloud Run. |
| Process crash on boot | Missing `JWT_SECRET`, or Node ≠ 22 (`node:sqlite`). Logs show `JWT_SECRET is required…`. |
| Cloud Run: revision did not start/listen on PORT | **First check JWT.** Missing `JWT_SECRET` exits before bind and looks exactly like a PORT timeout. Listen is `0.0.0.0:$PORT`. Set `JWT_SECRET` on the service, then rebuild tip ≥ hotfix. See `deploy/CLOUD_RUN_BOOT_CHECK.md`. |
| App not responding (JWT is set) | Not honoring `PORT`. Logs should show `[Lumera] listening on 0.0.0.0:<port>`. |
| Policy URL 404 | SPA fallback not running (static host) or rewrite missing. |
| Webhook GET 500 | Expected until `META_VERIFY_TOKEN` is set. |
| Hosting rewrite 404 from Cloud Run | Wrong `serviceId` / `region` (must be `lumera-gemini-edit` / `asia-south1`), Hosting site not created (Console still on **Get started**), or region not in Firebase’s rewrite allow-list. |
| Cloud Build / `gcloud run deploy --image` fails: `run.googleapis.com/sources` “not referenced by a container” | Service still has AI Studio / `--source` template annotation (sometimes `image: scratch`). Clear it (§2b) and deploy **image only** from `cloudbuild.yaml`. Do not add `--source` to the same pipeline. |
| Cloud Build `clear-source-annotation` fails: `runtimeClassName can only be set … when annotation [run.googleapis.com/base-images] is also set` | Export-strip dropped `base-images` but left `runtimeClassName: run.googleapis.com/linux-base-image-update`. The helper must delete that field too (§2b). Do not call `--remove-annotations`. |

---

## 9. Retired Hostinger notes

`deploy/hostinger-webapp.settings.json` is **retired**. `ecosystem.config.cjs` is an optional VPS leftover only — not how www is hosted.
