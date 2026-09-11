# Cloud Run boot check (`lumera-gemini-edit`)

Do not treat `revision … did not start/listen on PORT` as a bind bug until
Cloud Run logs are checked.

## What the process does

1. `applyBundledServerNodeEnv()` — `dist/server.cjs` implies `NODE_ENV=production`.
2. `failFastRequiredProductionEnv()` — **exits immediately** if `JWT_SECRET` is
   missing or a placeholder. Log line:
   `JWT_SECRET is required in production (no weak default).`
   That crash happens **before** `listen`. Cloud Run then reports a PORT timeout
   even though `app.listen(PORT, "0.0.0.0")` is correct.
3. Register `/healthz` (`200 ok`) and the rest of the Express app.
4. `app.listen(0.0.0.0, resolveListenPort())` — honors injected `PORT` (`3000`
   on this AI Studio service; `8080` is only the Dockerfile default when unset).
5. Then `initDatabase()` + reminder scheduler.

## CoS action

Set a real `JWT_SECRET` on service `lumera-gemini-edit` (`asia-south1`) via
Secret Manager or Cloud Run Console. `cloudbuild.yaml` uses `--update-env-vars`
for `APP_URL` / `NODE_ENV` only and **must not wipe** `JWT_SECRET`.

Then rebuild / redeploy tip **≥ this hotfix SHA**.

No fake JWT defaults in production.
