/* ============================================================================
   FILM — shared builders for the seven Task 7 films. Loaded after kit.js.
   Every builder returns an element plus a pure show(t, ...) so scenes stay a
   function of time, as the kit requires.
   ========================================================================== */
const F = (() => {
  const { E, tr, lerp, set } = K;

  /**
   * Every number shown on screen, copied from the committed reports in
   * examples/<fixture>/report.json. Nothing here is illustrative.
   */
  const DATA = {
    canvas: { w: 1200, h: 627 },
    chromium: '156.0.8078.4',
    checks: [
      'input_contract', 'required_fields', 'assets', 'canvas',
      'content_present', 'overflow', 'approved_text_preserved', 'safe_binding',
    ],
    normal: { titleLines: 2, bodyLines: 6, bodyRegionPx: 312.5, bodyPx: 204, pngSha: '278a53d02e829eb3' },
    longTitle: { lines: 6, maxLines: 3, overflowPx: 156, regionPx: 156, contentPx: 312 },
    longBody: { lines: 14, overflowPx: 163.5, regionPx: 312.5, contentPx: 476 },
    digest: {
      recorded: '13f63a810a525410a2b1d75510ac6389e8e109353ef38916cfd87bb0c48652c7',
      computed: '0404d2f8482994f6ddf374d6a5aceea646eb4a1a425a870667f611e14d569d5f',
    },
    script: { requests: 0, dialogs: 0, csp: 0, pageErrors: 0 },
  };

  /** Paths to real artefacts, relative to a scene file. */
  const ART = (fixture, file) => '../../../examples/' + fixture + '/' + file;

  function el(parent, cls, html, style) {
    const d = document.createElement('div');
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    if (style) Object.assign(d.style, style);
    parent.appendChild(d);
    return d;
  }

  /** "TASK 7 — FILM 03 / 07 — LONG TITLE", top left, on every film. */
  function series(stage, n, title) {
    const d = el(stage, 'series', '<b>Task 7</b><i></i>Film ' + n + ' / 07<i></i>' + title);
    d.show = (t) => set(d, { o: tr(t, 0.15, 0.8, E.out) });
    return d;
  }

  /**
   * The burned-in subtitle track. cues = [[t0, t1, label, html], ...].
   * One element per cue, cross-fading, so the track is a pure function of t.
   */
  function subs(stage, cues) {
    const els = cues.map(([, , k, html]) => el(stage, 'subt', '<span class="sk">' + k + '</span><span>' + html + '</span>'));
    return (t) => {
      cues.forEach(([t0, t1], i) => {
        const a = tr(t, t0, t0 + 0.45, E.out5);
        const b = tr(t, t1 - 0.3, t1, E.lin);
        set(els[i], { o: a * (1 - b) });
        els[i].style.transform = 'translate(-50%,' + lerp(18, 0, a) + 'px)';
      });
    };
  }

  /** The shared sign-off: statement, project line, one CTA, URL, honest footnote. */
  function endcard(stage, word) {
    const card = K.endcard(stage, { word, mark: null });
    const note = el(stage, 'endnote',
      'Candidate submission &middot; Atomity engineering challenge &middot; synthetic data &middot; not an official Atomity film');
    const show = card.show;
    card.show = (t, t0) => {
      const p = show(t, t0);
      set(note, { o: tr(t, t0 + 1.0, t0 + 1.8, E.out) });
      return p;
    };
    return card;
  }

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /** JSON source as highlighted lines, one .jl per line, for line-by-line animation. */
  function jsonLines(obj) {
    return JSON.stringify(obj, null, 2).split('\n').map((line) => {
      const h = esc(line)
        .replace(/^(\s*)("[^"]+")(:)/, '$1<span class="jk">$2</span><span class="jp">$3</span>')
        .replace(/(: )("(?:[^"\\]|\\.)*")(,?)$/, '$1<span class="js">$2</span><span class="jp">$3</span>')
        .replace(/(: )(true|false|null|-?\d[\d.]*)(,?)$/, '$1<span class="jn">$2</span><span class="jp">$3</span>');
      return '<span class="jl">' + (h || ' ') + '</span>';
    }).join('');
  }

  /** A rendered PNG from examples/, framed. */
  function shot(stage, src, o) {
    const d = el(stage, 'shot', '<img src="' + src + '" alt="">' + (o.label ? '<span class="label">' + o.label + '</span>' : ''), {
      left: o.x + 'px', top: o.y + 'px', width: o.w + 'px', height: Math.round(o.w * 627 / 1200) + 'px', zIndex: o.z || 20,
    });
    return d;
  }

  /**
   * The live showcase in a browser frame, with a camera over the real capture.
   * cam(t, keys): keys = [{t, x, y, z}] — (x, y) is the site point (CSS px) held at
   * the centre of the viewport, z the zoom. Eased between keys.
   */
  function site(stage, o) {
    const S = window.SITE;
    const f = el(stage, 'frame site', null, {
      left: o.x + 'px', top: o.y + 'px', width: o.w + 'px', height: o.h + 'px', zIndex: o.z || 20,
    });
    f.innerHTML =
      '<div class="bar fbar"><div class="dot3"><span></span><span></span><span></span></div>' +
      '<div class="url-bar"><span class="lock"></span><b>task-7-insight-template.vercel.app</b>' + (o.path || '') + '</div></div>' +
      '<div class="fbody"><div class="view"><img src="' + (o.src || '../footage/site.png') + '" width="' + (o.imgW || S.width) + '" alt=""></div></div>';
    const body = f.querySelector('.fbody');
    body.style.height = (o.h - 64) + 'px';
    const view = f.querySelector('.view');
    const vw = o.w, vh = o.h - 64;
    f.cam = (t, keys) => {
      let a = keys[0], b = keys[0], p = 0;
      if (t >= keys[keys.length - 1].t) { a = b = keys[keys.length - 1]; }
      else if (t > keys[0].t) {
        for (let i = 0; i < keys.length - 1; i++) {
          if (t >= keys[i].t && t < keys[i + 1].t) {
            a = keys[i]; b = keys[i + 1];
            p = (b.e || E.io4)(K.clamp01((t - a.t) / (b.t - a.t)));
            break;
          }
        }
      }
      const z = lerp(a.z, b.z, p), cx = lerp(a.x, b.x, p), cy = lerp(a.y, b.y, p);
      view.style.transform = 'translate(' + (vw / 2 - cx * z) + 'px,' + (vh / 2 - cy * z) + 'px) scale(' + z + ')';
    };
    f.show = (t, t0, tOut) => {
      const i = tr(t, t0, t0 + 0.9, E.out5);
      const out = tOut == null ? 0 : tr(t, tOut, tOut + 0.7, E.io);
      set(f, { o: i * (1 - out), y: lerp(90, 0, i) + out * -80, s: lerp(1.04, 1, i) * lerp(1, 0.94, out) });
    };
    /** Centre of a captured element's box, for camera keys. */
    f.at = (name, dx = 0, dy = 0) => {
      const bx = S.boxes[name];
      return { x: bx.x + bx.w / 2 + dx, y: bx.y + bx.h / 2 + dy };
    };
    /** Stage position of a site point while the camera holds `key` — for aiming the cursor. */
    f.project = (key, sx, sy) => ({
      x: o.x + vw / 2 + (sx - key.x) * key.z,
      y: o.y + 64 + vh / 2 + (sy - key.y) * key.z,
    });
    /**
     * One card's real "Checks open" capture, laid exactly over the card, revealed
     * top-down from t0 like the panel expanding under a click.
     */
    f.openCard = (name) => {
      const bx = S.boxes['card:' + name];
      const img = document.createElement('img');
      img.src = '../footage/card-' + name + '-open.png';
      Object.assign(img.style, { position: 'absolute', left: bx.x + 'px', top: bx.y + 'px', width: bx.w + 'px', opacity: '0',
        borderRadius: '16px', boxShadow: '0 30px 60px -20px rgba(0,0,0,.45)' });
      view.appendChild(img);
      return (t, t0) => {
        const p = tr(t, t0, t0 + 0.45, E.out5);
        img.style.opacity = t >= t0 ? '1' : '0';
        img.style.clipPath = 'inset(0 0 ' + lerp(100 - (bx.h / (bx.h + 194)) * 100, 0, p) + '% 0)';
      };
    };
    return f;
  }

  return { DATA, ART, el, series, subs, endcard, jsonLines, esc, shot, site };
})();
