"""Render SRT cues as caption PNGs (Lexend, night box) and print an ffmpeg
filter_complex that overlays each one only during its cue. Captions are added
on top of the real frames; frames are never edited.
Usage: python3 -I captions.py <captions.srt> <Lexend.ttf> <outdir> <width> <height>"""
import re, sys
from PIL import Image, ImageDraw, ImageFont

srt, font_path, outdir, W, H = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
text = open(srt, encoding='utf-8').read()
cues = re.findall(r'(\d\d):(\d\d):(\d\d),(\d\d\d) --> (\d\d):(\d\d):(\d\d),(\d\d\d)\n(.+?)(?:\n\n|\n?$)', text, re.S)
font = ImageFont.truetype(font_path, 26)
inputs, chain = [], '[0:v]'
filters = []
for i, c in enumerate(cues):
    a = int(c[0]) * 3600 + int(c[1]) * 60 + int(c[2]) + int(c[3]) / 1000
    b = int(c[4]) * 3600 + int(c[5]) * 60 + int(c[6]) + int(c[7]) / 1000
    words, lines, line = c[8].strip().split(), [], ''
    for w in words:
        t = (line + ' ' + w).strip()
        if font.getlength(t) > W * 0.8 and line:
            lines.append(line); line = w
        else:
            line = t
    lines.append(line)
    lh = 36
    bw = int(max(font.getlength(l) for l in lines)) + 40
    bh = lh * len(lines) + 24
    img = Image.new('RGBA', (bw, bh), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, bw - 1, bh - 1], radius=14, fill=(5, 6, 8, 220), outline=(230, 255, 79, 255), width=2)
    for k, l in enumerate(lines):
        d.text((20, 12 + k * lh), l, font=font, fill=(250, 250, 250, 255))
    p = f'{outdir}/cap{i}.png'
    img.save(p)
    inputs.append(p)
    nxt = f'[v{i}]'
    filters.append(f"{chain}[{i + 1}:v]overlay=x=(W-w)/2:y=H-h-28:enable='between(t,{a:.3f},{b:.3f})'{nxt}")
    chain = nxt
print('\n'.join(inputs))
print('---')
print(';'.join(filters))
print(chain)
