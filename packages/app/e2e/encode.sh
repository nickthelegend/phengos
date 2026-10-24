#!/usr/bin/env bash
# Encode screencast frames (real timestamps) to a constant-30fps H.264 MP4.
# Usage: e2e/encode.sh <frames-dir> <out.mp4> [captions.srt]
# Captions are overlaid as separate rendered PNGs (e2e/captions.py); the frames are never edited.
set -euo pipefail
DIR="$1"; OUT="$2"; SRT="${3:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
node -e '
const fs=require("fs");const dir=process.argv[1];const t=JSON.parse(fs.readFileSync(dir+"/times.json"));
let s="";for(let i=0;i<t.length;i++){const d=i+1<t.length?Math.max(0.005,t[i+1]-t[i]):0.033;s+=`file '"'"'f${String(i).padStart(5,"0")}.jpg'"'"'\nduration ${d.toFixed(4)}\n`;}
s+=`file '"'"'f${String(t.length-1).padStart(5,"0")}.jpg'"'"'\n`;fs.writeFileSync(dir+"/list.txt",s);' "$DIR"
BASE="fps=30,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x050608"
cd "$DIR"
if [ -z "$SRT" ]; then
  ffmpeg -loglevel error -y -f concat -safe 0 -i list.txt -vf "$BASE" -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart "$OUT"
else
  mkdir -p caps
  python3 -I "$HERE/captions.py" "$SRT" "$HERE/../public/fonts/Lexend-Regular.ttf" caps 1280 720 > caps/plan.txt
  INPUTS=(); while IFS= read -r line; do [ "$line" = "---" ] && break; INPUTS+=(-i "$line"); done < caps/plan.txt
  FILTER="$(sed -n '/^---$/{n;p;}' caps/plan.txt)"
  LAST="$(tail -1 caps/plan.txt)"
  ffmpeg -loglevel error -y -f concat -safe 0 -i list.txt "${INPUTS[@]}" \
    -filter_complex "[0:v]$BASE[base];${FILTER/\[0:v\]/[base]}" -map "$LAST" \
    -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart "$OUT"
fi
ffprobe -v error -show_entries format=duration -of default=nw=1 "$OUT"
