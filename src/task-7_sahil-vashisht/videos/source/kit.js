/* ============================================================================
   MOTION ENGINE
   ----------------------------------------------------------------------------
   Every film is a pure function of time: render(t) fully describes the frame,
   with no state carried between frames. That is what makes the films seekable,
   so the capture rig can jump to frame n, screenshot, and get a pixel-identical
   result every run. No CSS animations, no transitions, no rAF-accumulated
   state anywhere in a scene file.
   ========================================================================== */

const K = (() => {
  const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
  const lerp = (a, b, p) => a + (b - a) * p;

  /* easings ---------------------------------------------------------------- */
  const E = {
    lin: (p) => p,
    out: (p) => 1 - Math.pow(1 - p, 3),
    out4: (p) => 1 - Math.pow(1 - p, 4),
    out5: (p) => 1 - Math.pow(1 - p, 5),
    in: (p) => p * p * p,
    io: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
    io4: (p) => (p < 0.5 ? 8 * p * p * p * p : 1 - Math.pow(-2 * p + 2, 4) / 2),
    // slight overshoot — used for things that "land"
    back: (p) => {
      const c = 1.9;
      return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
    },
    // damped spring, settles by p=1
    spring: (p) => {
      if (p >= 1) return 1;
      return 1 - Math.pow(2, -9 * p) * Math.cos(p * Math.PI * 3.1);
    },
  };

  /** Normalised progress of a track running t0..t1, eased. */
  const tr = (t, t0, t1, ease) => (ease || E.out)(clamp01((t - t0) / (t1 - t0)));

  /** 0 -> 1 -> 0 pulse across t0..t1 (hold = fraction spent at 1). */
  const pulse = (t, t0, t1, hold = 0.5, ease = E.io) => {
    const p = clamp01((t - t0) / (t1 - t0));
    const up = (1 - hold) / 2;
    if (p < up) return ease(p / up);
    if (p < up + hold) return 1;
    return ease(1 - (p - up - hold) / up);
  };

  /* style application ------------------------------------------------------ */
  /**
   * set(el, props) — the only way scenes touch the DOM.
   *  o opacity | x y px | s scale | r deg | b blur px | w/h px | cl clip-inset%
   */
  function set(el, p) {
    if (!el) return;
    const s = el.style;
    if (p.o !== undefined) s.opacity = p.o;
    const tf = [];
    if (p.x !== undefined || p.y !== undefined)
      tf.push(`translate3d(${p.x || 0}px,${p.y || 0}px,0)`);
    if (p.r !== undefined) tf.push(`rotate(${p.r}deg)`);
    if (p.s !== undefined) tf.push(`scale(${p.s})`);
    if (p.sx !== undefined) tf.push(`scaleX(${p.sx})`);
    if (p.sy !== undefined) tf.push(`scaleY(${p.sy})`);
    if (tf.length) s.transform = tf.join(' ');
    if (p.b !== undefined) s.filter = p.b > 0.01 ? `blur(${p.b}px)` : 'none';
    if (p.w !== undefined) s.width = p.w + 'px';
    if (p.h !== undefined) s.height = p.h + 'px';
    if (p.cl !== undefined) s.clipPath = `inset(0 ${100 - p.cl}% 0 0)`;
    if (p.bg !== undefined) s.background = p.bg;
    if (p.c !== undefined) s.color = p.c;
    if (p.bc !== undefined) s.borderColor = p.bc;
    if (p.z !== undefined) s.zIndex = p.z;
  }

  /** Fade + rise + slight blur — the house "enter" for any block. */
  function enter(el, t, t0, d = 0.7, dy = 60, ease = E.out5) {
    const p = tr(t, t0, t0 + d, ease);
    set(el, { o: p, y: lerp(dy, 0, p), b: lerp(10, 0, Math.min(1, p * 1.6)) });
    return p;
  }

  /** Reverse of enter, for beats that leave. */
  function exit(el, t, t0, d = 0.45, dy = -50, ease = E.in) {
    const p = tr(t, t0, t0 + d, ease);
    set(el, { o: 1 - p, y: lerp(0, dy, p) });
    return p;
  }

  /**
   * Masked line reveal for `.rv > i` children — the signature type move.
   * Each line's riser slides up out of its own clipping shell.
   */
  function lines(root, t, t0, opt = {}) {
    const { step = 0.085, d = 0.72, ease = E.out5, from = 108 } = opt;
    const items = root.querySelectorAll('.rv > i');
    items.forEach((el, i) => {
      const p = tr(t, t0 + i * step, t0 + i * step + d, ease);
      el.style.transform = `translate3d(0,${lerp(from, 0, p)}%,0)`;
      el.style.opacity = p < 0.02 ? 0 : 1;
    });
  }

  /** Same, but as a plain % translate (no offsetHeight read). */
  function linesOut(root, t, t0, opt = {}) {
    const { step = 0.05, d = 0.4, ease = E.in, to = -108 } = opt;
    const items = root.querySelectorAll('.rv > i');
    items.forEach((el, i) => {
      const p = tr(t, t0 + i * step, t0 + i * step + d, ease);
      el.style.transform = `translate3d(0,${lerp(0, to, p)}%,0)`;
    });
  }

  /** Integer / formatted counter. */
  function count(el, t, t0, t1, from, to, fmt, ease = E.out4) {
    const p = tr(t, t0, t1, ease);
    const v = lerp(from, to, p);
    el.textContent = fmt ? fmt(v) : Math.round(v).toLocaleString('en-GB');
    return p;
  }

  /** Character-by-character type-on. */
  function type(el, t, t0, cps, text, caret = true) {
    const n = Math.max(0, Math.floor((t - t0) * cps));
    const shown = text.slice(0, Math.min(n, text.length));
    const on = n < text.length && Math.floor(t * 2.2) % 2 === 0;
    el.textContent = shown + (caret && n >= 0 && on ? '|' : '');
    return Math.min(1, n / text.length);
  }

  /**
   * Interpolate a scripted cursor path. pts = [{t, x, y, e?}], ascending t.
   * Holds the first point before the path starts and the last one after.
   */
  function wayp(t, pts) {
    if (t <= pts[0].t) return { x: pts[0].x, y: pts[0].y };
    const last = pts[pts.length - 1];
    if (t >= last.t) return { x: last.x, y: last.y };
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      if (t >= a.t && t < b.t) {
        const p = (b.e || E.io)(clamp01((t - a.t) / (b.t - a.t)));
        return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p) };
      }
    }
    return { x: last.x, y: last.y };
  }

  /** Build the house cursor: pointer + a ring that fires on click. */
  function cursor(parent) {
    const c = document.createElement('div');
    c.className = 'cur';
    c.innerHTML =
      '<svg width="46" height="54" viewBox="0 0 46 54" fill="none">' +
      '<path d="M4 2.5 4 44 15.2 33.6 22.4 50 30.6 46.4 23.6 30.4 39 29.6Z" ' +
      'fill="#fff" stroke="#05070a" stroke-width="3.4" stroke-linejoin="round"/></svg>' +
      '<span class="ring"></span>';
    parent.appendChild(c);
    return c;
  }

  /** Click feedback: expanding mint ring at the cursor, plus a press dip. */
  function click(cur, t, times, win = 0.42) {
    const ring = cur.querySelector('.ring');
    let best = 0, press = 0;
    (times || []).forEach((ct) => {
      const p = clamp01((t - ct) / win);
      if (t >= ct && p < 1) best = Math.max(best, p);
      const d = Math.abs(t - ct);
      if (d < 0.1) press = Math.max(press, 1 - d / 0.1);
    });
    set(ring, { o: best > 0 ? 1 - best : 0, s: lerp(0.15, 1.9, E.out(best)) });
    set(cur.querySelector('svg'), { s: 1 - press * 0.16 });
    return best;
  }

  /** Deterministic pseudo-random, so "scattered" things scatter identically. */
  function rnd(i, salt = 1) {
    const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  /* atmosphere ------------------------------------------------------------- */
  function atmo(stage, glows) {
    const a = document.createElement('div');
    a.className = 'atmo';
    a.innerHTML = '<div class="grid-bg"></div>';
    (glows || []).forEach((g) => {
      const d = document.createElement('div');
      d.className = 'glow';
      d.style.width = g.w + 'px';
      d.style.height = (g.h || g.w) + 'px';
      d.style.left = g.x + 'px';
      d.style.top = g.y + 'px';
      d.style.background = 'radial-gradient(circle closest-side, ' + g.c + ', transparent 78%)';
      d.style.opacity = g.o == null ? 0.5 : g.o;
      a.appendChild(d);
    });
    stage.prepend(a);
    const v = document.createElement('div');
    v.className = 'vig';
    stage.appendChild(v);
    const gr = document.createElement('div');
    gr.className = 'grain';
    stage.appendChild(gr);
    return a;
  }

  /** Drift the atmosphere glows so no frame is ever quite static. */
  function drift(atmoEl, t) {
    const gs = atmoEl.querySelectorAll('.glow');
    gs.forEach((g, i) => {
      const f = 0.055 + i * 0.021;
      set(g, {
        x: Math.sin(t * f * 6.28) * (70 + i * 30),
        y: Math.cos(t * f * 5.1) * (60 + i * 24),
      });
    });
  }

  /* boot ------------------------------------------------------------------- */
  /**
   * boot({dur, render}) wires the scene up for both playback and capture.
   * Capture mode (?capture=1) exposes window.__seek(t) and nothing animates on
   * its own; preview mode runs a looping clock and scales the board to fit.
   */
  function boot(cfg) {
    const stage = document.getElementById('stage');
    const dur = cfg.dur;
    const capture = /[?&]capture=1/.test(location.search);

    const tick = document.createElement('div');
    tick.className = 'tick';
    stage.appendChild(tick);

    function frame(t) {
      const tt = Math.max(0, Math.min(dur, t));
      cfg.render(tt);
      tick.style.width = (tt / dur) * 100 + '%';
    }

    function fit() {
      if (capture) return;
      const k = Math.min(
        window.innerWidth / stage.offsetWidth,
        window.innerHeight / stage.offsetHeight
      );
      stage.style.transform = `scale(${k})`;
    }

    if (capture) {
      document.body.classList.add('capture');
      window.__dur = dur;
      window.__size = { w: stage.offsetWidth, h: stage.offsetHeight };
      window.__seek = (t) => { frame(t); return true; };
      frame(0);
      window.__ready = true;
    } else {
      fit();
      window.addEventListener('resize', fit);
      let start = performance.now();
      let paused = false;
      let pt = 0;
      const loop = (now) => {
        if (!paused) {
          const t = ((now - start) / 1000) % (dur + 0.9);
          frame(t);
          pt = t;
        }
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
      document.addEventListener('click', () => { start = performance.now(); });
      document.addEventListener('keydown', (e) => {
        if (e.key === ' ') { paused = !paused; if (!paused) start = performance.now() - pt * 1000; }
      });
    }
  }


  /* ---------------------------------------------------------------- builders */
  /**
   * A burned-in caption block. Returns the element plus a render(t, t0, t1)
   * that fades it in at t0 and out at t1 — the same move in every film.
   */
  function cap(stage, o) {
    const d = document.createElement('div');
    d.className = 'cap' + (o.size ? ' ' + o.size : '');
    d.style.top = o.top + 'px';
    d.innerHTML =
      (o.k ? '<div class="capk">' + o.k + '</div>' : '') +
      '<div class="capt">' + o.t + '</div>';
    stage.appendChild(d);
    d.show = (t, t0, t1) => {
      const i = tr(t, t0, t0 + 0.75, E.out5);
      const out = t1 == null ? 0 : tr(t, t1, t1 + 0.42, E.lin);
      set(d, { o: i * (1 - out), y: lerp(46, 0, i) + out * -34 });
      return i;
    };
    return d;
  }

  /**
   * The series sign-off. Every film lands on the same shape: mark, statement,
   * the brand line, one CTA, the URL — so eleven films read as one campaign.
   */
  function endcard(stage, o) {
    const d = document.createElement('div');
    d.className = 'endcard';
    const B = window.BRAND || {};
    const mark = o.mark === undefined ? B.mark : o.mark;
    d.innerHTML =
      '<div class="ei">' +
      (mark ? '<img class="mark" src="' + mark + '" alt="">' : '') +
      '<div class="word">' + o.word + '</div>' +
      '<div class="tag">' + (o.tag || B.tagline || '') + '</div>' +
      '<div class="cta">' + (o.cta || B.cta || 'Get started') + '</div>' +
      '<span class="url">' + (o.url || B.url || '') + '</span>' +
      '</div>';
    stage.appendChild(d);
    const ei = d.querySelector('.ei');
    const mk = d.querySelector('.mark');   // null when the brand has no mark
    const ct = d.querySelector('.cta');
    d.show = (t, t0) => {
      const p = tr(t, t0, t0 + 0.9, E.out5);
      set(d, { o: p });
      set(ei, { s: lerp(1.07, 1, p), y: lerp(38, 0, p) });
      set(mk, {
        s: lerp(0.5, 1, tr(t, t0, t0 + 1.1, E.spring)),
        r: lerp(-38, 0, tr(t, t0, t0 + 1.2, E.out5)),
      });
      const cp = tr(t, t0 + 0.85, t0 + 1.35, E.spring);
      set(ct, { o: tr(t, t0 + 0.85, t0 + 1.05, E.out), s: lerp(0.82, 1, cp) });
      // a slow breath, so the final seconds are never a frozen frame
      if (t > t0 + 1.5) set(ct, { o: 1, s: 1 + Math.sin((t - t0) * 2.4) * 0.012 });
      return p;
    };
    return d;
  }

  /** A Clover app window. Returns the frame with .body to fill. */
  function appframe(stage, o) {
    const f = document.createElement('div');
    f.className = 'frame';
    f.style.left = o.x + 'px';
    f.style.top = o.y + 'px';
    f.style.width = o.w + 'px';
    f.style.height = o.h + 'px';
    f.innerHTML =
      '<div class="bar fbar"><div class="dot3"><span></span><span></span><span></span></div>' +
      '<div class="flogo">' +
      ((window.BRAND || {}).mark ? '<img src="' + window.BRAND.mark + '" alt="">' : '') +
      o.title + '</div>' +
      (o.right ? '<div class="fright">' + o.right + '</div>' : '') +
      '</div><div class="fbody"></div>';
    stage.appendChild(f);
    f.body = f.querySelector('.fbody');
    f.show = (t, t0, tOut) => {
      const i = tr(t, t0, t0 + 0.95, E.out5);
      const out = tOut == null ? 0 : tr(t, tOut, tOut + 0.85, E.io);
      set(f, {
        o: i * (1 - out),
        y: lerp(120, 0, i) + out * -140,
        s: lerp(1.06, 1, i) * lerp(1, 0.9, out),
        b: lerp(14, 0, i),
      });
      return i;
    };
    return f;
  }

  return { clamp01, lerp, E, tr, pulse, set, enter, exit, lines, linesOut, count, type,
    rnd, atmo, drift, boot, wayp, cursor, click, cap, endcard, appframe };
})();
