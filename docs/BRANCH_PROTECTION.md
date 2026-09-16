# Branch protection & required status checks

Lumera merges to **`main` with merge commits** (not squash). PRs must not land
until lint, the test suite, and a production build have passed.

Lumera is **not** a certified Meta Tech Provider. Contact **ravee@lumer.me**.

## Required GitHub status check

GitHub Actions workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)

| Check name (branch protection) | Job | What it runs |
|---|---|---|
| **`lint-and-test`** | `lint-and-test` | `npm ci` (or `npm install` if no lockfile) → `npm run lint` (`tsc --noEmit`) → `npm run test` → `npm run build` |

That single job is the merge gate. A failing lint, unit/integration test, or
Vite/esbuild production build fails the check. `continue-on-error` is forbidden.

GitHub → Settings → Branches → Branch protection rule on **`main`**:

1. Require a pull request before merging.
2. Require status checks to pass before merging.
3. Require branches to be up to date before merging (recommended).
4. Status checks that are required: **`lint-and-test`**.
5. Do **not** allow bypassing for admins on this check unless the founder
   explicitly decides otherwise (`ravee@lumer.me`).
6. Merge method: **merge commit** (disable squash if the org default is squash).

Apply / verify from a laptop with `gh` admin on `Lumertech/Lumera-Gemini-edit`:

```bash
npm run verify:branch-protection
# or
bash scripts/verify-branch-protection.sh --apply
```

`--apply` PATCHes the `main` protection rule. Without `--apply` the script only
checks files and, if `gh` is authenticated, prints whether `lint-and-test` is
required today.

## GCP Cloud Build (deploy gate, not a GitHub check by default)

[`cloudbuild.yaml`](../cloudbuild.yaml) step **`lint-test`** runs the same
`npm run lint` + `npm run test` **before** Docker build (`waitFor: ['lint-test']`).
Image push and Cloud Run deploy cannot start if tests fail.

Cloud Build is the **deploy** gate for `lumera-gemini-edit` in `asia-south1`.
It does **not** automatically appear as a GitHub required status unless the
Cloud Build GitHub App is connected and the trigger is set to report checks.

If that App is connected, also require:

- Cloud Build / trigger name that wraps `lint-test` (exact check name is in the
  GitHub Checks tab on a recent `main` SHA)

Do not treat a green GitHub `lint-and-test` as “production is durable”. Cloud
Run still **exits before listen** without real `JWT_SECRET` and `DATABASE_URL`
(see `deploy/CLOUD_RUN_BOOT_CHECK.md`).

## What is not a merge gate

- `.github/workflows/restore-api-ts.yml` — emergency restore on a feature
  branch; not required on `main`.
- Hostinger / AI Studio Publish — not part of this repo’s merge contract.
