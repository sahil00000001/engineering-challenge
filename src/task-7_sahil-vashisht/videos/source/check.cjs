/* ============================================================================
   Sanity-check the showreel page before publishing it as an Artifact: no
   console errors, no broken images, no horizontal overflow, and the three type
   roles actually resolved rather than silently falling back.

     node check.cjs                  checks ../showreel.html
     node check.cjs some/page.html
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const { playwright } = require('./tools.cjs');

const toUrl = (p) => 'file:///' + p.split(path.sep).join('/');

(async () => {
  const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'showreel.html'));
  if (!fs.existsSync(file)) throw new Error('no such page: ' + file);

  const { chromium } = playwright();
  const browser = await chromium.launch();
  let bad = 0;

  for (const width of [1400, 820, 390]) {
    const p = await browser.newPage({ viewport: { width, height: 1000 } });
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

    await p.goto(toUrl(file));
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(500);

    const r = await p.evaluate(() => {
      const one = (sel) => document.querySelector(sel);
      const fam = (el) => (el ? getComputedStyle(el).fontFamily.split(',')[0].replace(/"/g, '') : null);
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        imgs: document.images.length,
        // an <img> with no src yet (the lightbox) is expected, so report which
        broken: [...document.images]
          .filter((i) => (!i.complete || i.naturalWidth === 0) && i.getAttribute('src'))
          .length,
        bodyBg: getComputedStyle(document.body).backgroundColor,
        display: fam(one('h1')),
        prose: fam(one('.ftreat')) || fam(one('.lede')),
        mono: fam(one('.eyebrow')),
      };
    });

    const problems = [];
    if (r.overflow > 0) problems.push('horizontal overflow ' + r.overflow + 'px');
    if (r.broken > 0) problems.push(r.broken + ' broken image(s)');
    if (r.bodyBg === 'rgba(0, 0, 0, 0)') problems.push('body has no explicit background');
    if (width === 1400) {
      for (const [role, val] of [['display', r.display], ['prose', r.prose], ['mono', r.mono]]) {
        if (!val || /^(system-ui|serif|sans-serif|ui-monospace|Georgia|monospace)$/.test(val)) {
          problems.push(role + ' font fell back to ' + val);
        }
      }
    }
    if (errs.length) problems.push('js: ' + [...new Set(errs)].join(' | '));

    if (problems.length) bad++;
    console.log(
      `${String(width).padStart(4)}px  ${problems.length ? 'FAIL  ' + problems.join('; ') : 'ok'}` +
        `   [${r.imgs} imgs, fonts: ${r.display}/${r.prose}/${r.mono}]`
    );

    if (width === 1400) {
      const out = path.join(path.dirname(file), 'check-shots');
      fs.mkdirSync(out, { recursive: true });
      await p.screenshot({ path: path.join(out, 'top.png') });
      for (const sel of ['.films .film', '.notes']) {
        const ok = await p.evaluate((s) => {
          const el = document.querySelector(s);
          if (!el) return false;
          el.scrollIntoView();
          return true;
        }, sel);
        if (ok) {
          await p.waitForTimeout(300);
          await p.screenshot({ path: path.join(out, sel.replace(/[^a-z]/gi, '') + '.png') });
        }
      }
      console.log('        stills -> ' + out);
    }
    await p.close();
  }

  await browser.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
