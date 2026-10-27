/* ============================================================================
   Frame-exact renderer.
   ----------------------------------------------------------------------------
   Each scene exposes window.__seek(t), window.__dur and window.__size. We step
   time by hand (1/FPS), screenshot, and pipe straight into x264 — no on-screen
   playback, so a slow frame costs render time but never drops or duplicates a
   frame, and two runs are byte-identical.

   The second pass matters as much as the first: JPEG frames are full-range, so
   the H.264 out of pass one is tagged yuvj420p. Some platforms mishandle that
   on near-black content (crushed blacks, clipped accent). Pass two converts to
   limited-range bt709, which is what a master should be.

     node render.cjs                    all scenes in ../scenes
     node render.cjs 04 07              only scenes whose filename contains these
     node render.cjs --jobs 4           render four at once
     node render.cjs --preview          first 4s only, to check timing
     node render.cjs --no-range-fix     skip pass two (faster, for drafts)
   ========================================================================== */
const { spawn } = require('child_process');
const { once } = require('events');
const fs = require('fs');
const path = require('path');
const { ffmpeg, playwright } = require('./tools.cjs');

const SRC = __dirname;                        // <project>/source
const ROOT = path.resolve(SRC, '..');         // <project>
const SCENES = path.join(SRC, 'scenes');
const FILMS = path.join(ROOT, 'films');
const POSTERS = path.join(ROOT, 'posters');

const argv = process.argv.slice(2);
function flag(name, dflt) {
  const i = argv.indexOf('--' + name);
  if (i === -1) return dflt;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
}
function bool(name) {
  const i = argv.indexOf('--' + name);
  if (i === -1) return false;
  argv.splice(i, 1);
  return true;
}

const FPS = Number(flag('fps', 30));
const QUALITY = Number(flag('q', 96));
const CRF = String(flag('crf', 17));
const JOBS = Number(flag('jobs', 4));
const PREVIEW = bool('preview');
const NO_RANGE_FIX = bool('no-range-fix');
const filters = argv.filter((a) => !a.startsWith('--'));

const FF = ffmpeg();
const { chromium } = playwright();

fs.mkdirSync(FILMS, { recursive: true });
fs.mkdirSync(POSTERS, { recursive: true });

const toUrl = (p) => 'file:///' + p.split(path.sep).join('/');

/** Pass one: JPEG frames in, H.264 out. */
function encoder(outFile) {
  const ff = spawn(FF, [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(FPS), '-i', 'pipe:0',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF,
    '-profile:v', 'high', '-level', '4.2',
    '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-movflags', '+faststart',
    outFile,
  ]);
  ff.stderr.on('data', (d) => process.stderr.write(d));
  return ff;
}

/** Pass two: full-range -> limited-range bt709, which is what platforms expect. */
function rangeFix(file) {
  const tmp = file.replace(/\.mp4$/, '.tv.mp4');
  return new Promise((resolve, reject) => {
    const ff = spawn(FF, [
      '-y', '-hide_banner', '-loglevel', 'error', '-i', file,
      '-vf', 'scale=in_range=full:out_range=tv',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', String(Number(CRF) - 1),
      '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p',
      '-color_range', 'tv', '-colorspace', 'bt709',
      '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-movflags', '+faststart', tmp,
    ]);
    ff.stderr.on('data', (d) => process.stderr.write(d));
    ff.on('close', (code) => {
      if (code !== 0) return reject(new Error('range fix failed for ' + file));
      fs.rmSync(file);
      fs.renameSync(tmp, file);
      resolve();
    });
  });
}

(async () => {
  const files = fs
    .readdirSync(SCENES)
    .filter((f) => f.endsWith('.html'))
    .filter((f) => !filters.length || filters.some((s) => f.includes(s)))
    .sort();

  if (!files.length) {
    console.error('no scenes matched in ' + SCENES);
    process.exit(1);
  }
  console.log(`rendering ${files.length} scene(s) at ${FPS}fps, ${JOBS} job(s)`);
  console.log('ffmpeg: ' + FF + '\n');

  const browser = await chromium.launch({
    args: ['--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none'],
  });

  const queue = files.slice();
  const failures = [];

  async function renderOne(page, file) {
    const name = file.replace(/\.html$/, '');
    const t0 = Date.now();

    await page.goto(toUrl(path.join(SCENES, file)) + '?capture=1', { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });

    // A silent font fallback is the single most common way a render goes wrong,
    // so it is a hard check rather than a warning.
    const fontOk = await page.evaluate(() => document.fonts.check('800 100px Display'));
    if (!fontOk) {
      throw new Error(
        `${name}: the Display face did not load — check source/fonts/display.woff2 exists\n` +
          '  (python source/fetch-font.py "Plus Jakarta Sans")'
      );
    }

    const { dur, size } = await page.evaluate(() => ({ dur: window.__dur, size: window.__size }));
    await page.setViewportSize({ width: size.w, height: size.h });

    const frames = Math.round((PREVIEW ? Math.min(dur, 4) : dur) * FPS);

    // poster: a frame from the product beat, not frame 0
    await page.evaluate((t) => window.__seek(t), Math.min(dur * 0.55, dur - 1));
    await page.screenshot({ path: path.join(POSTERS, name + '.png') });

    const outFile = path.join(FILMS, name + '.mp4');
    const ff = encoder(outFile);
    const done = once(ff, 'close');

    for (let f = 0; f < frames; f++) {
      await page.evaluate((t) => window.__seek(t), f / FPS);
      const buf = await page.screenshot({ type: 'jpeg', quality: QUALITY });
      if (!ff.stdin.write(buf)) await once(ff.stdin, 'drain');
      if (f && f % 200 === 0) {
        console.log(`  ${name}  ${String(Math.round((f / frames) * 100)).padStart(3)}%`);
      }
    }
    ff.stdin.end();
    const [code] = await done;
    if (code !== 0) throw new Error(name + ': x264 exited ' + code);

    if (!NO_RANGE_FIX) await rangeFix(outFile);

    const mb = (fs.statSync(outFile).size / 1048576).toFixed(1);
    console.log(
      `  ${name}  DONE  ${dur}s  ${frames}f  ${size.w}x${size.h}  ${mb}MB  ` +
        `[${Math.round((Date.now() - t0) / 1000)}s]`
    );
  }

  async function worker() {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    while (queue.length) {
      const file = queue.shift();
      try {
        await renderOne(page, file);
      } catch (e) {
        failures.push(e.message);
        console.error('  FAILED ' + file + ': ' + e.message);
      }
    }
    await page.close();
  }

  await Promise.all(Array.from({ length: Math.min(JOBS, files.length) }, worker));
  await browser.close();

  console.log('\nout: ' + FILMS);
  if (failures.length) {
    console.error('\n' + failures.length + ' scene(s) failed');
    process.exit(1);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
