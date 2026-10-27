"""Assemble the handover folder: finished masters, poster frames, the brief, the
showreel, and the full re-renderable source.

    python source/package.py ../my-client-films
    python source/package.py C:/work/acme/acme-films

Leaves the working folder alone — the destination is a clean copy that can be
zipped, committed, or handed to someone who has never seen the pipeline.
"""
import argparse
import pathlib
import shutil
import sys

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parent

SOURCE_FILES = [
    'brand.css', 'brand.js', 'kit.css', 'kit.js', 'showreel.css',
    'tools.cjs', 'render.cjs', 'shots.cjs', 'sheet.cjs', 'check.cjs',
    'fetch-font.py', 'thumbs.py', 'build-deliverables.py', 'package.py',
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('dest', help='handover folder to create (overwritten if it exists)')
    ap.add_argument('--keep-shots', action='store_true',
                    help='also copy the review contact sheets')
    a = ap.parse_args()

    films = ROOT / 'films'
    if not films.exists() or not list(films.glob('*.mp4')):
        sys.exit('no masters in ' + str(films) + ' — run: node source/render.cjs')

    dest = pathlib.Path(a.dest).resolve()
    if dest == ROOT:
        sys.exit('destination is the working folder; pick a different path')
    if dest.exists():
        shutil.rmtree(dest)

    (dest / 'films').mkdir(parents=True)
    (dest / 'posters').mkdir()
    (dest / 'source').mkdir()

    for f in sorted(films.glob('*.mp4')):
        shutil.copy2(f, dest / 'films' / f.name)
    if (ROOT / 'posters').exists():
        for f in sorted((ROOT / 'posters').glob('*.png')):
            shutil.copy2(f, dest / 'posters' / f.name)

    for name in ['README.md', 'showreel.html', 'films.json']:
        if (ROOT / name).exists():
            shutil.copy2(ROOT / name, dest / name)

    # scenes reference ../brand.css and ../brand/mark.svg, which keeps working
    # because they land in source/scenes next to source/brand.css again
    shutil.copytree(HERE / 'scenes', dest / 'source' / 'scenes')
    for d in ['brand', 'fonts']:
        if (HERE / d).exists():
            shutil.copytree(HERE / d, dest / 'source' / d)
    for name in SOURCE_FILES:
        if (HERE / name).exists():
            shutil.copy2(HERE / name, dest / 'source' / name)

    if a.keep_shots and (ROOT / 'sheets').exists():
        shutil.copytree(ROOT / 'sheets', dest / 'review-sheets')

    mb = sum(f.stat().st_size for f in (dest / 'films').glob('*.mp4')) / 1048576
    print(f'films:   {len(list((dest / "films").glob("*.mp4")))} ({mb:.1f} MB)')
    print(f'posters: {len(list((dest / "posters").glob("*.png")))}')
    print('->', dest)


if __name__ == '__main__':
    main()
