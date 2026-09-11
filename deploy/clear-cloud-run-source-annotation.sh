#!/usr/bin/env bash
# Clear leftover Cloud Run source-deploy metadata so an image-based
# `gcloud run deploy --image` can succeed.
#
# AI Studio Publish / `gcloud run deploy --source` writes
# `run.googleapis.com/sources` on the revision template (and often pairs it
# with `image: scratch`). A later Cloud Build that only pushes a container
# then fails with:
#   spec.template.metadata.annotations[run.googleapis.com/sources]:
#   Source annotation has sources that are not referenced by a container.
#
# CoS one-liner (may no-op on CLIs that lack --remove-annotations):
#   gcloud run services update lumera-gemini-edit \
#     --region=asia-south1 \
#     --project=gen-lang-client-0108182367 \
#     --remove-annotations=run.googleapis.com/sources
#
# This helper runs that flag first, then export → strip template annotations →
# rewrite `image: scratch` → `gcloud run services replace` when needed.
set -euo pipefail

SERVICE="${SERVICE:-lumera-gemini-edit}"
REGION="${REGION:-asia-south1}"
PROJECT="${PROJECT:-gen-lang-client-0108182367}"
IMAGE="${IMAGE:-}"
FILE=""
OUT=""
DRY_RUN=0
SELF_TEST=0

usage() {
  cat <<'EOF'
Usage:
  deploy/clear-cloud-run-source-annotation.sh [options]

Flags accept `--name VALUE` or `--name=VALUE` (Cloud Build / bash
passes the latter as a single argv token).

Live (default):
  --service NAME     Cloud Run service (default: lumera-gemini-edit)
  --region REGION    Region (default: asia-south1)
  --project PROJECT  GCP project (default: gen-lang-client-0108182367)
  --image IMAGE      Rewrite image: scratch to this URI (required if scratch)
  --dry-run          Print stripped YAML; do not replace

Offline (no gcloud):
  --file YAML        Read a `gcloud run services describe --format=export` file
  --out YAML         Write stripped YAML (default: stdout)

  --self-test        Run fixture checks and exit
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --service=*) SERVICE="${1#*=}"; shift ;;
    --service) SERVICE="$2"; shift 2 ;;
    --region=*) REGION="${1#*=}"; shift ;;
    --region) REGION="$2"; shift 2 ;;
    --project=*) PROJECT="${1#*=}"; shift ;;
    --project) PROJECT="$2"; shift 2 ;;
    --image=*) IMAGE="${1#*=}"; shift ;;
    --image) IMAGE="$2"; shift 2 ;;
    --file=*) FILE="${1#*=}"; shift ;;
    --file) FILE="$2"; shift 2 ;;
    --out=*) OUT="${1#*=}"; shift ;;
    --out) OUT="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --self-test) SELF_TEST=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# Stdlib-only stripper. Cloud SDK images may not have PyYAML.
strip_export() {
  local image="${1:-}"
  # Program is -c so caller stdin (export YAML) reaches Python.
  python3 -c '
import re, sys
image = sys.argv[1] if len(sys.argv) > 1 else ""
text = sys.stdin.read()
skip = (
    "run.googleapis.com/sources",
    "run.googleapis.com/base-images",
)
image_line = re.compile(r"^(\s*(?:-\s+)?)image:\s*(.*)$")
out = []
for line in text.splitlines(True):
    if any(key in line for key in skip):
        continue
    match = image_line.match(line.rstrip("\n"))
    if image and match:
        raw = match.group(2).strip().strip(chr(34) + chr(39))
        if raw == "scratch":
            nl = "\n" if line.endswith("\n") else ""
            out.append("%simage: %s%s" % (match.group(1), image, nl))
            continue
    out.append(line)
sys.stdout.write("".join(out))
' "$image"
}

run_self_test() {
  local fail=0
  local got

  got="$(strip_export "gcr.io/demo/app:abc" <<'YAML'
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: lumera-gemini-edit
  annotations:
    run.googleapis.com/sources: '{"": "gs://bucket/archive"}'
spec:
  template:
    metadata:
      annotations:
        run.googleapis.com/sources: '{"": "gs://bucket/archive"}'
        run.googleapis.com/base-images: '{"": "nodejs"}'
        autoscaling.knative.dev/maxScale: "5"
    spec:
      containers:
      - image: scratch
        env:
        - name: JWT_SECRET
          value: keep-me
YAML
)"

  if grep -q 'run.googleapis.com/sources' <<<"$got"; then
    echo "FAIL: sources annotation still present" >&2
    fail=1
  fi
  if grep -q 'run.googleapis.com/base-images' <<<"$got"; then
    echo "FAIL: base-images annotation still present" >&2
    fail=1
  fi
  if ! grep -q 'image: gcr.io/demo/app:abc' <<<"$got"; then
    echo "FAIL: scratch image was not rewritten" >&2
    fail=1
  fi
  if grep -q 'image: scratch' <<<"$got"; then
    echo "FAIL: scratch placeholder remains" >&2
    fail=1
  fi
  if ! grep -q 'JWT_SECRET' <<<"$got"; then
    echo "FAIL: env was not preserved" >&2
    fail=1
  fi
  if ! grep -q 'autoscaling.knative.dev/maxScale' <<<"$got"; then
    echo "FAIL: unrelated annotation was dropped" >&2
    fail=1
  fi

  got="$(strip_export "" <<'YAML'
spec:
  template:
    spec:
      containers:
      - image: gcr.io/demo/app:old
YAML
)"
  if [[ "$got" != *$'\n'"      - image: gcr.io/demo/app:old"$'\n' ]]; then
    if ! grep -q 'image: gcr.io/demo/app:old' <<<"$got"; then
      echo "FAIL: existing real image should stay when IMAGE is empty" >&2
      fail=1
    fi
  fi

  # Parser smoke: Cloud Build passes `--service=VALUE` as one argv token.
  # Offline --file/--out path needs no gcloud.
  local tmp_in tmp_out parser_err
  tmp_in="$(mktemp)"
  tmp_out="$(mktemp)"
  parser_err="$(mktemp)"
  cat >"$tmp_in" <<'YAML'
spec:
  template:
    spec:
      containers:
      - image: gcr.io/demo/app:old
YAML
  if ! bash "${BASH_SOURCE[0]}" \
      --service=lumera-gemini-edit \
      --region=asia-south1 \
      --project=demo-project \
      --image=gcr.io/demo/app:abc \
      --file="$tmp_in" \
      --out="$tmp_out" \
      2>"$parser_err"; then
    echo "FAIL: --service=lumera-gemini-edit argv form was rejected" >&2
    cat "$parser_err" >&2
    fail=1
  elif grep -q 'Unknown argument' "$parser_err"; then
    echo "FAIL: --flag=VALUE produced Unknown argument" >&2
    cat "$parser_err" >&2
    fail=1
  fi
  if ! bash "${BASH_SOURCE[0]}" \
      --service lumera-gemini-edit \
      --file "$tmp_in" \
      --out "$tmp_out" \
      2>"$parser_err"; then
    echo "FAIL: --service VALUE argv form was rejected" >&2
    cat "$parser_err" >&2
    fail=1
  fi
  rm -f "$tmp_in" "$tmp_out" "$parser_err"

  if [[ "$fail" -ne 0 ]]; then
    echo "self-test failed" >&2
    exit 1
  fi
  echo "self-test ok"
}

if [[ "$SELF_TEST" -eq 1 ]]; then
  run_self_test
  exit 0
fi

if [[ -n "$FILE" ]]; then
  if [[ ! -f "$FILE" ]]; then
    echo "File not found: $FILE" >&2
    exit 1
  fi
  stripped="$(strip_export "$IMAGE" <"$FILE")"
  [[ "$stripped" == *$'\n' || -z "$stripped" ]] || stripped+=$'\n'
  if [[ -n "$OUT" ]]; then
    printf '%s' "$stripped" >"$OUT"
  else
    printf '%s' "$stripped"
  fi
  exit 0
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "gcloud is required for live mode. Use --file for offline strip." >&2
  exit 1
fi

echo "Attempting CoS annotation flag on ${SERVICE} (${REGION} / ${PROJECT})..."
gcloud run services update "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --remove-annotations=run.googleapis.com/sources \
  || true

if ! gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format='value(metadata.name)' >/dev/null 2>&1; then
  echo "Service ${SERVICE} does not exist yet; image deploy will create it."
  exit 0
fi

tmp_in="$(mktemp)"
tmp_out="$(mktemp)"
trap 'rm -f "$tmp_in" "$tmp_out"' EXIT

gcloud run services describe "${SERVICE}" \
  --region="${REGION}" \
  --project="${PROJECT}" \
  --format=export >"$tmp_in"

strip_export "$IMAGE" <"$tmp_in" >"$tmp_out"

if cmp -s "$tmp_in" "$tmp_out"; then
  echo "No leftover sources annotation or scratch image on ${SERVICE}."
  exit 0
fi

if grep -qE 'image:[[:space:]]*["'\'']?scratch["'\'']?[[:space:]]*$' "$tmp_out"; then
  echo "Stripped sources annotation but image is still scratch. Pass --image URI." >&2
  exit 1
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  cat "$tmp_out"
  exit 0
fi

echo "Replacing ${SERVICE} without run.googleapis.com/sources (preserving env)..."
gcloud run services replace "$tmp_out" \
  --region="${REGION}" \
  --project="${PROJECT}"
echo "Source annotation cleared."
