/* Checks that the dosing widget really works in THIS folder.
 *
 *   node test-deck.cjs            (run it where slides-demo.html lives)
 *
 * Two checks:
 *   1. Serve this folder over HTTP, load the rendered deck, and confirm the
 *      widget boots inside the iframe. The test is the presence of the
 *      app's own PKPD global, not the iframe's load event — a 404 page
 *      loads perfectly well, which is exactly why a missing app looks like
 *      a blank slide instead of an error.
 *   2. Negative control: copy the deck (WITHOUT mipd-lab.html) to a
 *      temporary folder and confirm the deck's built-in warning banner
 *      fires there. Without this, check 1 passing could just mean the
 *      detector never runs.
 *
 * Requires: npm install jsdom
 */
const { JSDOM, VirtualConsole } = require('jsdom');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');

const HERE = process.cwd();
const DECK = 'slides-demo.html';
const APP = 'mipd-lab.html';

let fails = 0;
const ok = (pass, label, detail) => {
  if (!pass) fails++;
  console.log(`${pass ? 'pass' : 'FAIL'}  ${label}${detail ? '  ' + detail : ''}`);
};

function serve(dir) {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      const p = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        rq.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html' : 'text/plain' });
        fs.createReadStream(p).pipe(rq);
      } else { rq.writeHead(404); rq.end('Not Found'); }
    });
    s.listen(0, '127.0.0.1', () => res(s));
  });
}

/* Load the deck from `dir` and report whether the widget booted and
   whether the deck's own warning banner fired. */
async function inspect(dir) {
  const s = await serve(dir);
  const url = `http://127.0.0.1:${s.address().port}/${DECK}`;
  let dom;
  try {
    dom = await JSDOM.fromURL(url, {
      runScripts: 'dangerously', resources: 'usable',
      pretendToBeVisual: true, virtualConsole: new VirtualConsole()
    });
  } catch (e) {
    s.close();
    return { error: e.message };
  }
  const w = dom.window;
  // jsdom has no canvas; the app only needs the calls not to throw.
  w.HTMLCanvasElement.prototype.getContext = () =>
    new Proxy({}, { get: () => () => ({ width: 10 }) });
  await new Promise(r => setTimeout(r, 4000));

  const el = w.document.getElementById('mipd-missing');
  const banner = !!(el && el.style.display === 'block');
  // Did any widget iframe actually load the app?
  let booted = false;
  Array.from(w.document.querySelectorAll('iframe')).forEach(f => {
    try { if (f.contentWindow && f.contentWindow.PKPD) booted = true; } catch (e) { /* opaque */ }
  });
  const slides = w.document.querySelectorAll('section').length;
  w.close(); s.close();
  return { banner, booted, slides };
}

(async () => {
  // Preconditions, reported as instructions rather than a stack trace.
  if (!fs.existsSync(path.join(HERE, DECK))) {
    console.log(`FAIL  ${DECK} is not in this folder (${HERE}).`);
    console.log('      Render it first:  quarto render slides-demo.qmd --to revealjs');
    process.exit(1);
  }
  const appHere = fs.existsSync(path.join(HERE, APP));
  ok(appHere, `${APP} sits beside the deck`,
     appHere ? '' : `copy ${APP} into ${HERE} and re-render — this is what makes widget slides blank`);

  console.log('\n— this folder —');
  const live = await inspect(HERE);
  if (live.error) {
    ok(false, 'the deck loads', live.error);
  } else {
    ok(live.slides > 0, 'the deck loads and has slides', `${live.slides} slides`);
    ok(live.booted, 'the widget boots inside the slide iframe',
       live.booted ? '' : 'the iframe loaded something, but it was not the app');
    ok(!live.banner, 'the deck raises no missing-widget warning',
       live.banner ? 'the deck itself reports the app is missing' : '');
  }

  // Negative control: same deck, app removed.
  console.log('\n— negative control (app deliberately absent) —');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mipd-deckcheck-'));
  try {
    fs.copyFileSync(path.join(HERE, DECK), path.join(tmp, DECK));
    const filesDir = path.join(HERE, 'slides-demo_files');
    if (fs.existsSync(filesDir)) {
      fs.cpSync(filesDir, path.join(tmp, 'slides-demo_files'), { recursive: true });
    }
    const ctrl = await inspect(tmp);
    if (ctrl.error) {
      ok(false, 'the control deck loads', ctrl.error);
    } else {
      ok(ctrl.banner, 'a missing app raises the warning banner',
         ctrl.banner ? '' : 'the detector did not fire — a silent blank slide would go unnoticed');
      ok(!ctrl.booted, 'and no widget boots without the app');
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  console.log(fails === 0
    ? '\nDECK CHECK PASSED — the widget runs in the slides.'
    : `\n${fails} CHECK(S) FAILED`);
  process.exit(fails ? 1 : 0);
})();
