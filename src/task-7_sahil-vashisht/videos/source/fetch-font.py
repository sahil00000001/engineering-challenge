"""Embed a display face so the render never depends on what is installed.

    python source/fetch-font.py "Plus Jakarta Sans"
    python source/fetch-font.py "Archivo" --weights "100..900"

Pulls the latin woff2 subset from Google Fonts into source/fonts/display.woff2,
which brand.css already points at. Roughly 25-40KB for a variable face.

Variable faces do not all share the same weight axis — Plus Jakarta Sans stops
at 800, Archivo goes to 900, and asking for a range the face does not have is a
400 from Google. So the requested range is tried first and then narrowed until
one works, rather than making the caller know each family's axis.

Any other foundry: drop the woff2 in yourself as source/fonts/display.woff2.
Nothing else needs to change.
"""
import argparse
import pathlib
import re
import sys
import urllib.error
import urllib.request

UA = ('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')

# tried in order; the first that Google accepts wins
FALLBACKS = ['200..900', '100..900', '200..800', '300..700', '400..700', None]


def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read()


def try_spec(family, weights):
    fam = family.replace(' ', '+')
    axis = f':wght@{weights}' if weights else ''
    url = f'https://fonts.googleapis.com/css2?family={fam}{axis}&display=swap'
    try:
        return get(url).decode('utf-8'), weights
    except urllib.error.HTTPError as e:
        if e.code in (400, 404):
            return None, weights
        raise


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('family', help='Google Fonts family name, e.g. "Plus Jakarta Sans"')
    ap.add_argument('--weights', default=None,
                    help='variable axis range, e.g. "200..800". Omit to auto-narrow.')
    ap.add_argument('--out', default=None,
                    help='destination woff2 (default source/fonts/display.woff2)')
    a = ap.parse_args()

    dest = pathlib.Path(a.out) if a.out else pathlib.Path(__file__).parent / 'fonts' / 'display.woff2'
    dest.parent.mkdir(parents=True, exist_ok=True)

    order = ([a.weights] + [w for w in FALLBACKS if w != a.weights]) if a.weights else FALLBACKS
    css = used = None
    for w in order:
        css, used = try_spec(a.family, w)
        if css:
            break
    if not css:
        sys.exit(f'Google Fonts has no family "{a.family}" (check the spelling and casing).')

    # css2 returns one @font-face per unicode subset; the last "latin" block is
    # the one worth embedding — everything else is accents we do not set.
    blocks = re.findall(r'/\*\s*([a-z0-9-]+)\s*\*/\s*@font-face\s*\{(.*?)\}', css, re.S)
    latin = [b for name, b in blocks if name == 'latin']
    if not latin:
        latin = re.findall(r'@font-face\s*\{(.*?)\}', css, re.S)
    if not latin:
        sys.exit('no @font-face block in the response — check the family name')

    block = latin[-1]
    m = re.search(r'url\((https://[^)]+\.woff2)\)', block)
    if not m:
        sys.exit('Google returned no woff2 (only ttf). Download the woff2 by hand '
                 'into ' + str(dest))

    data = get(m.group(1))
    dest.write_bytes(data)

    axis = re.search(r'font-weight:\s*([^;]+);', block)
    axis = axis.group(1).strip() if axis else '?'
    print(f'{a.family}  axis {used or "static"}  ->  {dest}  {len(data) / 1024:.1f}KB')
    print(f'  face reports font-weight: {axis}')
    if not used or ' ' not in axis:
        print('  ! this is a single-weight face, so heavy headlines will be '
              'synthesised. Prefer a variable family.')
    print('brand.css already references it as "Display"; nothing else to change.')


if __name__ == '__main__':
    main()
