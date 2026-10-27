"""Pull the chosen frames out of each finished master as small JPEGs, and emit a
manifest that build-deliverables.py embeds as data URIs.

Timecodes come from each film's "picks" in films.json — the three beats that
read best as a still, not a mechanical fraction of the runtime. Pick them after
looking at a contact sheet.

    python source/thumbs.py
"""
import base64
import json
import pathlib
import re
import subprocess
import sys

HERE = pathlib.Path(__file__).parent     # <project>/source
ROOT = HERE.parent                        # <project>
FILMS = ROOT / 'films'
SCENES = HERE / 'scenes'
THUMBS = ROOT / 'thumbs'
WIDTH = 288


def ffmpeg_bin():
    out = subprocess.run(
        ['node', str(HERE / 'tools.cjs')], capture_output=True, text=True
    )
    m = re.search(r'^ffmpeg\s+(.+)$', out.stdout, re.M)
    if not m:
        sys.exit('ffmpeg not found:\n' + out.stdout + out.stderr)
    return m.group(1).strip()


def main():
    spec = json.loads((ROOT / 'films.json').read_text(encoding='utf-8'))
    picks = {f['key']: f.get('picks') for f in spec['films']}
    FF = ffmpeg_bin()
    THUMBS.mkdir(exist_ok=True)

    manifest = {}
    for mp4 in sorted(FILMS.glob('*.mp4')):
        times = picks.get(mp4.stem)
        if not times:
            print('! no "picks" in films.json for', mp4.stem, '- skipped')
            continue

        # duration first, so a pick past the end is caught rather than
        # failing inside ffmpeg with a confusing encoder error
        scene = SCENES / (mp4.stem + '.html')
        dur = 0.0
        if scene.exists():
            m = re.search(r'const DUR\s*=\s*([\d.]+)', scene.read_text(encoding='utf-8'))
            if m:
                dur = float(m.group(1))
        if dur:
            over = [t for t in times if t >= dur]
            if over:
                print(f'! {mp4.stem}: picks {over} are past the {dur}s runtime - clamped')
            times = [min(t, round(dur - 0.5, 2)) for t in times]

        frames = []
        for i, t in enumerate(times):
            dst = THUMBS / f'{mp4.stem}-{i}.jpg'
            subprocess.run(
                [FF, '-y', '-hide_banner', '-loglevel', 'error',
                 '-ss', str(t), '-i', str(mp4), '-frames:v', '1',
                 '-vf', f'scale={WIDTH}:-2:flags=lanczos:out_range=full',
                 '-pix_fmt', 'yuvj420p', '-q:v', '5', str(dst)],
                check=True,
            )
            b = dst.read_bytes()
            frames.append({
                't': t,
                'kb': round(len(b) / 1024, 1),
                'uri': 'data:image/jpeg;base64,' + base64.b64encode(b).decode(),
            })

        manifest[mp4.stem] = {'bytes': mp4.stat().st_size, 'dur': dur, 'frames': frames}
        print(mp4.stem, 'ok', round(sum(f['kb'] for f in frames), 1), 'KB of stills')

    (ROOT / 'thumbs.json').write_text(json.dumps(manifest), encoding='utf-8')
    total = sum(f['kb'] for v in manifest.values() for f in v['frames'])
    print(f'films: {len(manifest)}   stills payload: {total / 1024:.2f} MB')


if __name__ == '__main__':
    main()
