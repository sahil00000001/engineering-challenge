/* ============================================================================
   Turn a scene's stills into one labelled contact sheet you can read in a
   single look. Twelve 9:16 frames side by side is the fastest way to find a
   blank frame, a collision, or a beat that does not read.

     node sheet.cjs            every scene that has stills
     node sheet.cjs 04         one scene
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const { playwright } = require('./tools.cjs');

const ROOT = path.resolve(__dirname, '..');   // <project>
const SHOTS = path.join(ROOT, 'shots');
const OUT = path.join(ROOT, 'sheets');

const toUrl = (p) => 'file:///' + p.split(path.sep).join('/');

(async () => {
  if (!fs.existsSync(SHOTS)) throw new Error('no shots yet — run: node shots.cjs');
  fs.mkdirSync(OUT, { recursive: true });

  const filter = process.argv[2];
  const dirs = fs.readdirSync(SHOTS).filter((d) => !filter || d.includes(filter));
  if (!dirs.length) throw new Error('no stills matching ' + filter);

  const { chromium } = playwright();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1200 } });
  // written into shots/ so the relative image paths resolve under file://:
  // a setContent page is about:blank and cannot load them
  const tmp = path.join(SHOTS, '_sheet.html');

  for (const d of dirs) {
    const files = fs
      .readdirSync(path.join(SHOTS, d))
      .filter((f) => f.endsWith('.jpg'))
      .sort((a, b) => parseFloat(a.slice(1).replace('_', '.')) - parseFloat(b.slice(1).replace('_', '.')));
    if (!files.length) continue;

    const cols = Math.min(6, files.length);
    const cells = files
      .map((f) => {
        const t = f.slice(1, -4).replace('_', '.');
        return `<figure><img src="${d}/${f}"><figcaption>${t}s</figcaption></figure>`;
      })
      .join('');

    fs.writeFileSync(
      tmp,
      `<style>
        body{margin:0;background:#0e0e10;font:600 22px system-ui;color:#8ef}
        h1{font-size:26px;padding:16px 20px 10px;color:#53fdca}
        .g{display:grid;grid-template-columns:repeat(${cols},1fr);gap:10px;padding:0 14px 18px}
        figure{margin:0}
        img{width:100%;display:block;border-radius:6px}
        figcaption{text-align:center;padding:7px 0;color:#7a8b85;font-size:19px}
      </style><h1>${d}</h1><div class="g">${cells}</div>`
    );

    await page.goto(toUrl(tmp));
    await page.evaluate(() =>
      Promise.all(
        Array.from(document.images).map((i) =>
          i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; })
        )
      )
    );
    await page.screenshot({ path: path.join(OUT, d + '.jpg'), type: 'jpeg', quality: 84, fullPage: true });
    console.log(d);
  }

  await browser.close();
  fs.rmSync(tmp, { force: true });
  console.log('\nout: ' + OUT);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
