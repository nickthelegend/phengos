#!/usr/bin/env bash
# Fetch the Vosk small English model (Apache-2.0, alphacephei.com/vosk/models) and
# repack it as the .tar.gz that vosk-browser loads. The archive is served from our
# own host at runtime (packages/app/public/models/), lazy-loaded only when the player
# turns voice on. It is not committed to git (about 40 MB).
set -euo pipefail
NAME=vosk-model-small-en-us-0.15
URL="https://alphacephei.com/vosk/models/${NAME}.zip"
# SHA-256 of the upstream zip, recorded on first download (Oct 24, 2026).
EXPECTED_SHA256="${VOSK_MODEL_SHA256:-$(cat "$(dirname "$0")/vosk-model.sha256" 2>/dev/null || true)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/packages/app/public/models"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"
if [ -f "$OUT/${NAME}.tar.gz" ]; then echo "already present: $OUT/${NAME}.tar.gz"; exit 0; fi
echo "downloading $URL"
curl -fL --retry 3 -o "$WORK/model.zip" "$URL"
SUM="$(shasum -a 256 "$WORK/model.zip" | cut -d' ' -f1)"
if [ -n "$EXPECTED_SHA256" ] && [ "$SUM" != "$EXPECTED_SHA256" ]; then
  echo "SHA-256 mismatch: got $SUM, expected $EXPECTED_SHA256" >&2; exit 1
fi
[ -z "$EXPECTED_SHA256" ] && echo "$SUM" > "$(dirname "$0")/vosk-model.sha256" && echo "recorded sha256 $SUM"
(cd "$WORK" && unzip -q model.zip && tar -czf "$OUT/${NAME}.tar.gz" "$NAME")
ls -la "$OUT/${NAME}.tar.gz"
