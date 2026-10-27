/* ============================================================================
   Tool discovery.
   ----------------------------------------------------------------------------
   The pipeline needs two things that are rarely on PATH: an ffmpeg with libx264,
   and Playwright's chromium. Both are usually already somewhere on a dev
   machine, so look before asking anyone to install anything.

   Override either with an env var:  FFMPEG=/path/to/ffmpeg  PLAYWRIGHT_DIR=/path/to/node_modules
   ========================================================================== */
const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = os.homedir();
const WIN = process.platform === 'win32';
const EXE = WIN ? '.exe' : '';

/* -------------------------------------------------------------- ffmpeg ---- */
function hasX264(bin) {
  try {
    const out = execFileSync(bin, ['-hide_banner', '-encoders'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 20000,
    });
    return /\blibx264\b/.test(out);
  } catch {
    return false;
  }
}

function candidatesFfmpeg() {
  const c = [];
  if (process.env.FFMPEG) c.push(process.env.FFMPEG);

  // on PATH?
  try {
    const which = WIN ? 'where ffmpeg' : 'command -v ffmpeg';
    execSync(which, { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' })
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((p) => c.push(p.trim()));
  } catch {}

  // imageio-ffmpeg ships a full build with libx264 and is a common transitive
  // dependency of anything that has touched video in python
  const pyRoots = [
    path.join(HOME, 'AppData/Local/Programs/Python'),
    path.join(HOME, 'AppData/Roaming/Python'),
    '/usr/lib/python3/dist-packages',
    '/usr/local/lib',
    path.join(HOME, '.local/lib'),
    path.join(HOME, 'Library/Python'),
  ];
  for (const root of pyRoots) {
    for (const d of walk(root, 4, (n) => n === 'imageio_ffmpeg')) {
      for (const f of safeReaddir(path.join(d, 'binaries'))) {
        if (/^ffmpeg/.test(f)) c.push(path.join(d, 'binaries', f));
      }
    }
  }

  // common manual installs
  [
    'C:/ffmpeg/bin/ffmpeg.exe',
    'C:/Program Files/ffmpeg/bin/ffmpeg.exe',
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
    path.join(HOME, 'bin/ffmpeg' + EXE),
  ].forEach((p) => c.push(p));

  return c.filter((p) => p && fs.existsSync(p));
}

function safeReaddir(d) {
  try {
    return fs.readdirSync(d);
  } catch {
    return [];
  }
}

/** Shallow bounded walk — never scan a whole disk looking for a binary. */
function walk(root, depth, match, found = []) {
  if (depth < 0 || !fs.existsSync(root)) return found;
  for (const name of safeReaddir(root)) {
    const p = path.join(root, name);
    let st;
    try {
      st = fs.statSync(p);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;
    if (match(name)) found.push(p);
    else walk(p, depth - 1, match, found);
  }
  return found;
}

let _ffmpeg;
function ffmpeg() {
  if (_ffmpeg) return _ffmpeg;
  const tried = [];
  for (const c of candidatesFfmpeg()) {
    tried.push(c);
    if (hasX264(c)) return (_ffmpeg = c);
  }
  throw new Error(
    'No ffmpeg with libx264 found.\n' +
      'Tried:\n  ' + (tried.join('\n  ') || '(nothing)') + '\n\n' +
      'Note: Playwright bundles an ffmpeg, but it is stripped to VP8/webm only —\n' +
      'it cannot produce the H.264 masters this pipeline delivers.\n\n' +
      'Fix by either:\n' +
      '  pip install imageio-ffmpeg          (smallest, no PATH changes)\n' +
      '  winget install Gyan.FFmpeg          (Windows)\n' +
      '  brew install ffmpeg                 (macOS)\n' +
      '  apt install ffmpeg                  (Debian/Ubuntu)\n' +
      'or point FFMPEG at a build you already have.'
  );
}

/* ---------------------------------------------------------- playwright ---- */
function candidatesPlaywright() {
  const c = [];
  if (process.env.PLAYWRIGHT_DIR) c.push(process.env.PLAYWRIGHT_DIR);
  (process.env.NODE_PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
    .forEach((p) => c.push(p));

  // walk up from here and from the cwd
  for (const start of [__dirname, process.cwd()]) {
    let d = start;
    for (let i = 0; i < 8; i++) {
      c.push(path.join(d, 'node_modules'));
      const up = path.dirname(d);
      if (up === d) break;
      d = up;
    }
  }

  // global npm root
  try {
    c.push(
      execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'], encoding: 'utf8' }).trim()
    );
  } catch {}

  // Any sibling project on the machine will do — Playwright is only used to
  // drive a headless chromium, so borrowing an existing install beats asking
  // for another 200MB download. Bounded to the usual places people keep code.
  const roots = [
    path.join(HOME, 'Downloads'), path.join(HOME, 'Documents'),
    path.join(HOME, 'Projects'), path.join(HOME, 'projects'),
    path.join(HOME, 'dev'), path.join(HOME, 'src'), path.join(HOME, 'code'),
    path.join(HOME, 'repos'), path.join(HOME, 'work'), HOME,
  ];
  for (const root of roots) {
    for (const nm of walk(root, 2, (n) => n === 'node_modules')) {
      if (fs.existsSync(path.join(nm, 'playwright'))) c.push(nm);
    }
  }

  return c.filter(Boolean);
}

const CACHE = path.join(__dirname, '.toolpaths.json');

function readCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  } catch {
    return {};
  }
}

function writeCache(patch) {
  try {
    fs.writeFileSync(CACHE, JSON.stringify({ ...readCache(), ...patch }, null, 2));
  } catch {}
}

let _pw;
function playwright() {
  if (_pw) return _pw;
  try {
    return (_pw = require('playwright'));
  } catch {}

  // a previously discovered location, so the disk walk happens once
  const cached = readCache().playwrightDir;
  if (cached && fs.existsSync(path.join(cached, 'playwright'))) {
    try {
      const m = require(path.join(cached, 'playwright'));
      if (m && m.chromium) return (_pw = m);
    } catch {}
  }

  for (const dir of candidatesPlaywright()) {
    for (const pkg of ['playwright', 'playwright-core', '@playwright/test']) {
      const p = path.join(dir, pkg);
      if (fs.existsSync(p)) {
        try {
          const m = require(p);
          if (m && m.chromium) {
            writeCache({ playwrightDir: dir });
            return (_pw = m);
          }
        } catch {}
      }
    }
  }
  throw new Error(
    'Playwright not found.\n' +
      'Fix by either:\n' +
      '  npm i -D playwright && npx playwright install chromium\n' +
      'or point PLAYWRIGHT_DIR at a node_modules that already has it, e.g.\n' +
      '  PLAYWRIGHT_DIR=/path/to/some-project/node_modules node render.cjs'
  );
}

module.exports = { ffmpeg, playwright };

if (require.main === module) {
  let ok = true;
  try {
    console.log('ffmpeg     ', ffmpeg());
  } catch (e) {
    ok = false;
    console.error('ffmpeg      NOT FOUND\n' + e.message);
  }
  try {
    playwright();
    console.log('playwright  ok');
  } catch (e) {
    ok = false;
    console.error('playwright  NOT FOUND\n' + e.message);
  }
  process.exit(ok ? 0 : 1);
}
