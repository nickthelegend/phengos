"""Cut the Phengos film from the recorded takes (e2e/film.mjs).

Every frame is the app's real rendered output; the sound is the app's own mix.
Nothing in a frame is edited: captions are separate rendered PNGs overlaid in a
lower-left box (Lexend, the brand font), and the cut only trims and joins takes.

Usage: python3 -I e2e/film-cut.py <plan.json> <takes-dir> <fonts-dir> <out.mp4>
"""
import json
import os
import subprocess
import sys
import tempfile

from PIL import Image, ImageDraw, ImageFont

plan_path, takes, fonts, out = (os.path.abspath(p) for p in sys.argv[1:5])
plan = json.load(open(plan_path, encoding='utf-8'))
W, H, FPS = 1920, 1080, 30
work = tempfile.mkdtemp(prefix='phengos-cut-')
lexend = ImageFont.truetype(os.path.join(fonts, 'Lexend-Regular.ttf'), 36)
lexend_b = ImageFont.truetype(os.path.join(fonts, 'Lexend-Bold.ttf'), 36)
# Wide enough for ~30 characters a line, narrow enough to stay clear of the app's HUD (centre bottom).
WRAP = 560
mono = ImageFont.truetype(os.path.join(fonts, 'PTMono-Regular.ttf'), 24)


def run(args):
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode:
        raise SystemExit(f"{' '.join(args[:6])}...\n{r.stderr[-2000:]}")
    return r.stdout


def wrap(text, font, width):
    lines, line = [], ''
    for w in text.split():
        t = (line + ' ' + w).strip()
        if font.getlength(t) > width and line:
            lines.append(line)
            line = w
        else:
            line = t
    lines.append(line)
    return lines


def caption_png(text, path):
    """A lower-left caption: night box, firefly rule, white Lexend. A leading '!' sets it in bold."""
    bold = text.startswith('!')
    text = text.lstrip('!')
    font = lexend_b if bold else lexend
    lines = wrap(text, font, WRAP)
    lh = 50
    bw = int(max(font.getlength(l) for l in lines)) + 56
    bh = lh * len(lines) + 34
    img = Image.new('RGBA', (bw, bh), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, bw - 1, bh - 1], radius=18, fill=(5, 6, 8, 232))
    d.rectangle([0, 14, 6, bh - 15], fill=(230, 255, 79, 255))
    for k, l in enumerate(lines):
        d.text((30, 14 + k * lh), l, font=font, fill=(250, 250, 250, 255))
    img.save(path)


def label_png(text, path):
    w = int(mono.getlength(text)) + 28
    img = Image.new('RGBA', (w, 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, w - 1, 39], radius=10, fill=(5, 6, 8, 200))
    d.text((14, 7), text, font=mono, fill=(217, 219, 224, 255))
    img.save(path)


def take_video(name):
    """The whole take as constant-30 fps video from the screencast's real frame times, plus its audio delay."""
    d = os.path.join(takes, name)
    mp4 = os.path.join(work, f'{name}.mp4')
    times = json.load(open(os.path.join(d, 'times.json')))
    meta = json.load(open(os.path.join(d, 'events.json')))['done']
    if not os.path.exists(mp4):
        with open(os.path.join(work, f'{name}.txt'), 'w') as f:
            for i, t in enumerate(times):
                dur = max(0.005, times[i + 1] - t) if i + 1 < len(times) else 1 / FPS
                f.write(f"file '{d}/f{i:05d}.jpg'\nduration {dur:.4f}\n")
            f.write(f"file '{d}/f{len(times) - 1:05d}.jpg'\n")
        run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', os.path.join(work, f'{name}.txt'),
             '-vf', f'fps={FPS},scale={W}:{H}:flags=lanczos,format=yuv420p', '-c:v', 'libx264', '-crf', '14', '-preset', 'fast', mp4])
    audio = os.path.join(d, 'audio.webm')
    delay = None
    if os.path.exists(audio) and meta.get('audio'):
        first = (meta['firstFrameTs'] or 0) * 1000 - meta['startedAt']
        delay = max(0.0, (meta['audio']['offsetMs'] - first) / 1000)
    return mp4, (audio if delay is not None else None), delay or 0.0


segments = []
for i, seg in enumerate(plan['segments']):
    vid, audio, delay = take_video(seg['take'])
    a, b = seg['in'], seg['out']
    dur = b - a
    inputs = ['-ss', f'{a:.3f}', '-t', f'{dur:.3f}', '-i', vid]
    if audio:
        # Audio sits `delay` s after the video starts; trim the same window.
        inputs += ['-i', audio]
        afilter = f"[1:a]adelay={int(delay * 1000)}:all=1,atrim=start={a:.3f}:end={b:.3f},asetpts=PTS-STARTPTS,apad,atrim=0:{dur:.3f}"
    else:
        inputs += ['-f', 'lavfi', '-t', f'{dur:.3f}', '-i', 'anullsrc=r=48000:cl=stereo']
        afilter = '[1:a]anull'
    afilter += f",aformat=sample_rates=48000:channel_layouts=stereo,afade=t=in:d=0.12,afade=t=out:st={max(0, dur - 0.15):.3f}:d=0.15[a]"
    overlays = []
    for k, (t0, t1, text) in enumerate(seg.get('captions', [])):
        p = os.path.join(work, f's{i}c{k}.png')
        caption_png(text, p)
        overlays.append((p, t0, min(t1, dur), 'caption-top' if seg.get('captionsTop') else 'caption'))
    for k, (t0, t1, text) in enumerate(seg.get('labels', [])):
        p = os.path.join(work, f's{i}l{k}.png')
        label_png(text, p)
        overlays.append((p, t0, min(t1, dur), 'label'))
    chain, filters, extra = '[0:v]', [], []
    for k, (p, t0, t1, kind) in enumerate(overlays):
        extra += ['-i', p]
        idx = 2 + k
        pos = {'caption': 'x=56:y=H-h-56', 'caption-top': 'x=56:y=56', 'label': 'x=W-w-40:y=36'}[kind]
        nxt = f'[v{k}]'
        filters.append(f"{chain}[{idx}:v]overlay={pos}:enable='between(t,{t0:.3f},{t1:.3f})'{nxt}")
        chain = nxt
    vfilter = ';'.join(filters) if filters else '[0:v]null[v0]'
    if not filters:
        chain = '[v0]'
    fade = f"{chain}fade=t=in:st=0:d={seg.get('fadeIn', 0):.2f},fade=t=out:st={max(0, dur - seg.get('fadeOut', 0)):.3f}:d={seg.get('fadeOut', 0):.2f}[vout]" if (seg.get('fadeIn') or seg.get('fadeOut')) else f'{chain}null[vout]'
    so = os.path.join(work, f'seg{i:02d}.mp4')
    run(['ffmpeg', '-loglevel', 'error', '-y', *inputs, *extra, '-filter_complex', f'{vfilter};{fade};{afilter}',
         '-map', '[vout]', '-map', '[a]', '-r', str(FPS), '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p',
         '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', so])
    segments.append(so)
    print(f"segment {i}: {seg['take']} {a:.1f}-{b:.1f} ({dur:.1f} s){'' if audio else ' (no audio)'}")

lst = os.path.join(work, 'segments.txt')
with open(lst, 'w') as f:
    for s in segments:
        f.write(f"file '{s}'\n")
joined = os.path.join(work, 'joined.mp4')
run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', joined])
# One loudness pass over the app's own mix (quiet hums and chimes), video copied untouched.
run(['ffmpeg', '-loglevel', 'error', '-y', '-i', joined, '-c:v', 'copy', '-af', 'loudnorm=I=-20:TP=-2:LRA=11', '-c:a', 'aac', '-b:a', '192k',
     '-movflags', '+faststart', out])
print(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', out]).strip())
