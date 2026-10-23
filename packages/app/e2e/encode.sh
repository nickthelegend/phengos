#!/usr/bin/env bash
# Encode screencast frames (real timestamps) to a constant-30fps H.264 MP4.
# Usage: e2e/encode.sh <frames-dir> <out.mp4> [captions.srt]
set -euo pipefail
DIR="$1"; OUT="$2"; SRT="${3:-}"
node -e '
const fs=require("fs");const dir=process.argv[1];const t=JSON.parse(fs.readFileSync(dir+"/times.json"));
let s="";for(let i=0;i<t.length;i++){const d=i+1<t.length?Math.max(0.005,t[i+1]-t[i]):0.033;s+=`file '"'"'${dir}/f${String(i).padStart(5,"0")}.jpg'"'"'\nduration ${d.toFixed(4)}\n`;}
s+=`file '"'"'${dir}/f${String(t.length-1).padStart(5,"0")}.jpg'"'"'\n`;fs.writeFileSync(dir+"/list.txt",s);' "$DIR"
VF="fps=30,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=0x050608"
if [ -n "$SRT" ]; then
  VF="$VF,subtitles='$SRT':force_style='FontName=Lexend,FontSize=20,PrimaryColour=&H00FAFAFA,BackColour=&HC0080605,BorderStyle=4,Outline=0,Shadow=0,MarginV=28'"
fi
ffmpeg -loglevel error -y -f concat -safe 0 -i "$DIR/list.txt" -vf "$VF" -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart "$OUT"
ffprobe -v error -show_entries format=duration -of default=nw=1 "$OUT"
