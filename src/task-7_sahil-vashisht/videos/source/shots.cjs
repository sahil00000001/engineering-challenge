/* ============================================================================
   Stills for review, without waiting on a render.
   ----------------------------------------------------------------------------
   Reviewing a film by watching it is slow and easy to fool yourself with. A
   contact sheet catches the things that actually go wrong: type clipped by its
   own reveal mask, two beats colliding, a caption over a busy frame, and above
   all BLANK FRAMES where one beat has left before the next arrives.

     node shots.cjs 04                 twelve evenly spaced stills
     node shots.cjs 04 2.5 9 18.5      exactly these timecodes
     node shots.cjs all                every scene, twelve each
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const { playwright } = require('./tools.cjs');

const SRC = __dirname;
const ROOT = path.resolve(SRC, '..');
const SCENES = path.join(SRC, 'scenes');
const OUT = path.join(ROOT, 'shots');

const toUrl = (p) => 'file:///' + p.split(path.sep).join('/');

(async () => {
  // First arg is always the scene filter, the rest are timecodes. Positional
  // rather than type-sniffed, because a scene filter like "01" is also a number.
  const args = process.argv.slice(2);
  const first = args[0];
  const match = !first || first === 'all' || first === '-' ? null : first;
  const times = args.slice(1).map(Number).filter((n) => !isNaN(n));

  const files = fs
    .readdirSync(SCENES)
    .filter((f) => f.endsWith('.html') && (!match || f.includes(match)))
    .sort();
  if (!files.length) throw new Error('no scene matching ' + match);

  const { chromium } = playwright();
  const browser = await chromium.launch({
    args: ['--force-color-profile=srgb', '--font-render-hinting=none'],
  });
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });

  for (const file of files) {
    const name = file.replace(/\.html$/, '');
    const dir = path.join(OUT, name);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    const errs = [];
    const onErr = (e) => errs.push(String(e.message || e));
    const onLog = (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); };
    page.on('pageerror', onErr);
    page.on('console', onLog);

    await page.goto(toUrl(path.join(SCENES, file)) + '?capture=1');
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => window.__ready === true);
    const { dur, size } = await page.evaluate(() => ({ dur: window.__dur, size: window.__size }));
    await page.setViewportSize({ width: size.w, height: size.h });

    const ts = times.length
      ? times
      : Array.from({ length: 12 }, (_, i) => +((i + 0.5) * (dur / 12)).toFixed(2));

    for (const t of ts) {
      await page.evaluate((x) => window.__seek(x), t);
      await page.screenshot({
        path: path.join(dir, 't' + String(t).replace('.', '_') + '.jpg'),
        type: 'jpeg',
        quality: 88,
      });
    }

    page.off('pageerror', onErr);
    page.off('console', onLog);
    console.log(
      name + '  ' + ts.length + ' stills  dur ' + dur + 's' +
        (errs.length ? '  !! ERRORS: ' + [...new Set(errs)].join(' | ') : '')
    );
  }

  await browser.close();
  console.log('\nout: ' + OUT + '   (now: node sheet.cjs)');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
