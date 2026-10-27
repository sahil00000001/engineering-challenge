"""Generate showreel.html and README.md from films.json + thumbs.json.

Both come from one source of truth so they can never drift apart, and so a
re-render regenerates the page verbatim rather than needing 33 base64 stills
pasted into hand-written HTML.

    python source/build-deliverables.py
"""
import html
import json
import pathlib

HERE = pathlib.Path(__file__).parent
ROOT = HERE.parent

SPEC = json.loads((ROOT / 'films.json').read_text(encoding='utf-8'))
THUMBS = json.loads((ROOT / 'thumbs.json').read_text(encoding='utf-8')) \
    if (ROOT / 'thumbs.json').exists() else {}

C = SPEC['campaign']
FILMS = SPEC['films']

MARK_FILE = HERE / 'brand' / 'mark.svg'
MARK = MARK_FILE.read_text(encoding='utf-8') if MARK_FILE.exists() else ''


def esc(s):
    return html.escape(str(s), quote=False)


def d(key):
    return THUMBS.get(key, {})


def dur(key):
    return d(key).get('dur', 0)


def mb(key):
    return round(d(key).get('bytes', 0) / 1048576, 1)


# ============================================================== showreel ====
def film_block(f):
    frames = d(f['key']).get('frames', [])
    total = dur(f['key'])

    strip = ''.join(
        '<figure class="fr">'
        f'<button class="frbtn" type="button" data-full="{fr["uri"]}" '
        f'aria-label="Enlarge frame at {fr["t"]} seconds">'
        f'<img src="{fr["uri"]}" alt="Frame from {esc(f["title"])} at {fr["t"]}s" '
        'width="288" height="512" decoding="async">'
        '</button>'
        f'<figcaption>{float(fr["t"]):0.1f}s</figcaption>'
        '</figure>'
        for fr in frames
    )
    ticks = ''.join(
        f'<span class="tick" style="left:{(float(fr["t"]) / total * 100):.2f}%"></span>'
        for fr in frames
    ) if total else ''
    beats = ''.join(
        f'<li><span class="bt">{esc(t)}</span><span class="bd">{esc(txt)}</span></li>'
        for t, txt in f.get('beats', [])
    )

    return f'''
<article class="film" id="f{f['n']}">
  <div class="fnum" aria-hidden="true">{esc(f['n'])}</div>
  <div class="fmain">
    <header class="fhead">
      <h3>{esc(f['title'])}</h3>
      <p class="hook">{esc(f['hook'])}</p>
    </header>
    <div class="fstrip">
      {strip}
      <div class="ruler" aria-hidden="true"><span class="rline"></span>{ticks}</div>
    </div>
    <div class="fcols">
      <div class="ftreat">{f['treatment']}</div>
      <div class="fside">
        <dl class="meta">
          <dt>Audience</dt><dd>{esc(f['audience'])}</dd>
          <dt>Module</dt><dd>{esc(f.get('module', '—'))}</dd>
          <dt>Device</dt><dd>{esc(f['device'])}</dd>
          <dt>Call to action</dt><dd class="ctaval">{esc(f['cta'])}</dd>
        </dl>
        <ol class="beats">{beats}</ol>
        <p class="fileline">{esc(f['key'])}.mp4 &middot; {dur(f['key']):g}s &middot; {mb(f['key'])} MB</p>
      </div>
    </div>
  </div>
</article>'''


index_rows = ''.join(
    f'<tr><td class="ix-n">{esc(f["n"])}</td>'
    f'<td class="ix-t"><a href="#f{f["n"]}">{esc(f["title"])}</a></td>'
    f'<td class="ix-d">{dur(f["key"]):g}s</td>'
    f'<td class="ix-a">{esc(f["audience"])}</td></tr>'
    for f in FILMS
)
spine_items = ''.join(
    f'<li><span class="sp-n">{esc(a)}</span><span class="sp-d">{esc(b)}</span></li>'
    for a, b in C['spine']
)
order_items = ''.join(f'<li><a href="#f{n}">{esc(n)}</a></li>' for n in C['runOrder'])
notes = ''.join(
    f'<div class="note"><h4>{esc(i["title"])}</h4><p>{i["body"]}</p></div>'
    for i in C['signoff']['items']
)
thesis = ''.join(f'<p class="lede">{p}</p>' for p in C['thesis']['paras'])
handover = ''.join(f'<p class="lede">{p}</p>' for p in C['handover']['paras'])

total_dur = sum(dur(f['key']) for f in FILMS)
total_mb = round(sum(d(f['key']).get('bytes', 0) for f in FILMS) / 1048576, 1)
size = C.get('frame', '1080 &times; 1920 &middot; 30fps')

STYLE = (HERE / 'showreel.css').read_text(encoding='utf-8')

page = f'''<title>{esc(C['title'])}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="{C['fontsHref']}">
<style>
{STYLE}
</style>

<header class="top">
  <div class="wrap">
    {'<div class="mark">' + MARK + '</div>' if MARK else ''}
    <p class="eyebrow">{esc(C['eyebrow'])}</p>
    <h1>{esc(C['title'])}</h1>
    <p class="standfirst">{C['standfirst']}</p>
    <div class="specbar">
      <div><span>Films</span><b>{len(FILMS)}</b></div>
      <div><span>Total runtime</span><b>{total_dur:g}s</b></div>
      <div><span>Frame</span><b>{size}</b></div>
      <div><span>Codec</span><b>{esc(C.get('codec', 'H.264 · CRF 17'))}</b></div>
      <div><span>Audio</span><b>None, by design</b></div>
      <div><span>Masters</span><b>{total_mb} MB</b></div>
    </div>
  </div>
</header>

<section>
  <div class="wrap">
    <p class="eyebrow">The approach</p>
    <h2>{esc(C['thesis']['heading'])}</h2>
    {thesis}
    <ol class="spine">{spine_items}</ol>
  </div>
</section>

<section>
  <div class="wrap">
    <p class="eyebrow">The set</p>
    <h2>{esc(C['setHeading'])}</h2>
    <div class="ixwrap">
      <table class="ix">
        <thead><tr><th></th><th>Film</th><th>Length</th><th>Who it is for</th></tr></thead>
        <tbody>{index_rows}</tbody>
      </table>
    </div>
  </div>
</section>

<section class="films">
  <div class="wrap">{''.join(film_block(f) for f in FILMS)}</div>
</section>

<section>
  <div class="wrap">
    <p class="eyebrow">Distribution</p>
    <h2>Post as a series, not a batch.</h2>
    <p class="lede">{C['runOrderNote']}</p>
    <ol class="order">{order_items}</ol>
  </div>
</section>

<section class="notes">
  <div class="wrap">
    <p class="eyebrow">Before publication</p>
    <h2>{esc(C['signoff']['heading'])}</h2>
    <p class="lede">{C['signoff']['lede']}</p>
    <div class="notecols">{notes}</div>
    <div class="real">
      <h4>{esc(C['signoff']['real']['title'])}</h4>
      <p>{C['signoff']['real']['body']}</p>
    </div>
  </div>
</section>

<section>
  <div class="wrap">
    <p class="eyebrow">Handover</p>
    <h2>{esc(C['handover']['heading'])}</h2>
    {handover}
<pre><span class="c"># preview a film in a browser, looping (click to restart, space to pause)</span>
start source/scenes/{esc(FILMS[0]['key'])}.html   <span class="c"># Windows</span>
open  source/scenes/{esc(FILMS[0]['key'])}.html   <span class="c"># macOS</span>

<span class="c"># render everything, four at once</span>
node source/render.cjs <span class="k">--jobs</span> 4

<span class="c"># one film, then a labelled contact sheet of stills for review</span>
node source/render.cjs {esc(FILMS[0]['n'])}
node source/shots.cjs {esc(FILMS[0]['n'])} &amp;&amp; node source/sheet.cjs {esc(FILMS[0]['n'])}</pre>
  </div>
</section>

<footer><div class="wrap">{esc(C['brandName'])} &middot; {esc(C['url'])}</div></footer>

<dialog id="lb">
  <button class="close" type="button" autofocus>Close</button>
  <img alt="Enlarged film frame">
</dialog>

<script>
(() => {{
  const lb = document.getElementById('lb');
  const img = lb.querySelector('img');
  document.querySelectorAll('.frbtn').forEach((b) => {{
    b.addEventListener('click', () => {{
      img.src = b.dataset.full;
      img.alt = b.getAttribute('aria-label').replace('Enlarge', 'Film');
      lb.showModal();
    }});
  }});
  lb.querySelector('.close').addEventListener('click', () => lb.close());
  lb.addEventListener('click', (e) => {{ if (e.target === lb) lb.close(); }});
}})();
</script>
'''

(ROOT / 'showreel.html').write_text(page, encoding='utf-8')
print(f'showreel.html  {len(page.encode("utf-8")) / 1048576:.2f} MB')


# ================================================================ README ====
def md(s):
    """HTML fragment -> markdown. The campaign copy is authored once, as HTML for
    the showreel, so the README translates it rather than duplicating it."""
    import re
    s = re.sub(r'<em>(.*?)</em>', lambda m: '*' + m.group(1) + '*', s, flags=re.S)
    s = re.sub(r'<code>(.*?)</code>', lambda m: '`' + m.group(1) + '`', s, flags=re.S)
    s = re.sub(r'<br\s*/?>', ' ', s)
    s = re.sub(r'<[^>]+>', '', s)
    s = html.unescape(s)
    # hair and thin spaces are for the rendered page, not for a text file
    s = re.sub('[\u2009\u200a\u202f]', ' ', s).strip()
    # literal markup in the copy (e.g. a quoted <script> tag) must stay visible text;
    # GitHub would strip it as HTML otherwise
    return s.replace('<', '&lt;')


rows = '\n'.join(
    f'| {f["n"]} | [**{f["title"]}**](films/{f["key"]}.mp4) | {dur(f["key"]):g}s | {f["audience"]} | "{f["hook"].replace("<", "&lt;")}" |'
    for f in FILMS
)
detail = '\n'.join(
    f'### {f["n"]} — {f["title"]}\n'
    f'*{f.get("module", "")}{" · " if f.get("module") else ""}Device: {f["device"]}.*\n\n'
    f'{md(f["treatment"])}\n\n'
    f'**Audience:** {f["audience"]}  \n'
    f'**CTA:** {f["cta"]}\n'
    for f in FILMS
)
signoff_md = '\n'.join(
    f'{i + 1}. **{it["title"]}.** {md(it["body"])}'
    for i, it in enumerate(C['signoff']['items'])
)

readme = f'''# {C['brandName']} — "{C['title']}"

{md(C['standfirst'])}

---

## Why {len(FILMS)} films and not {'one' if len(FILMS) > 1 else 'a single generic one'}

{chr(10).join(md(p) for p in C['thesis']['paras'])}

Every film runs the same narrative spine:

{" → ".join("**" + a + "**" for a, _ in C['spine'])}

---

## The films

Each MP4 is in [`films/`](films), with a poster frame in [`posters/`](posters). They
also play on the live showcase at https://{C['url']}. Open
[`showreel.html`](showreel.html) locally for the stills and beats of every film.

| # | Film | Length | Audience | Opening line |
|---|------|--------|----------|--------------|
{rows}

{detail}
---

## Specification

| | |
|---|---|
| Frame | {size.replace('&times;', 'x').replace('&middot;', '·')} |
| Codec | H.264 High profile, level 4.2, yuv420p, limited-range bt709, faststart |
| Audio | none — by design |
| Copy | captions burned into the frame, so every film works muted |

## Suggested run order

{C['runOrderNote']}

{('`' + " → ".join(C['runOrder']) + '`') if C['runOrder'] else ''}

---

## What is real and what needs sign-off

{md(C['signoff']['lede'])}

{signoff_md}

**{C['signoff']['real']['title']}.** {md(C['signoff']['real']['body'])}

---

## Re-rendering and editing

{chr(10).join(md(p) for p in C['handover']['paras'])}

```bash
# one-time: npm ci in the submission folder (Playwright), and an ffmpeg with libx264
# (pip install imageio-ffmpeg is enough). This checks both are found:
node source/tools.cjs

# preview a film in a browser, looping (click to restart, space to pause)
start source/scenes/{FILMS[0]['key']}.html     # Windows
open  source/scenes/{FILMS[0]['key']}.html     # macOS

# render everything (four at once)
node source/render.cjs --jobs 4

# one film, and a contact sheet of stills for review
node source/render.cjs {FILMS[0]['n']}
node source/shots.cjs {FILMS[0]['n']} && node source/sheet.cjs {FILMS[0]['n']}

# regenerate showreel.html and this README from films.json
python source/thumbs.py && python source/build-deliverables.py
```

Shared across all films: `source/brand.css` and `source/brand.js` (the only
files to change per brand), `source/kit.css` (type scale, UI primitives) and
`source/kit.js` (easings, the masked line reveal, counters, the scripted cursor,
the caption and end-card builders).

To change aspect ratio, edit `--stage-w`/`--stage-h` in `source/brand.css`; the
renderer asks each page for its own size, so nothing else needs touching — but
check each scene's absolute y-positions still land.
'''

(ROOT / 'README.md').write_text(readme, encoding='utf-8')
print('README.md      ok')
