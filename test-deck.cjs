/* Verifies the deck's missing-widget self-check actually fires: serves the
   rendered deck over HTTP from a folder WITHOUT the app beside it (the
   reported failure) and from one WITH it. */
const { JSDOM, VirtualConsole } = require('jsdom');
const http = require('http'), fs = require('fs'), path = require('path');

function serve(dir) {
  return new Promise(res => {
    const s = http.createServer((req, rq) => {
      const p = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        rq.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html' : 'text/plain' });
        fs.createReadStream(p).pipe(rq);
      } else { rq.writeHead(404); rq.end('Not Found'); }
    });
    s.listen(0, () => res(s));
  });
}

(async () => {
  let fails = 0;
  for (const [label, dir, expect] of [
    ['widget MISSING beside deck', './caseA', true],
    ['widget PRESENT beside deck', './caseB', false]]) {
    const s = await serve(dir);
    const vc = new VirtualConsole();
    const dom = await JSDOM.fromURL(
      `http://127.0.0.1:${s.address().port}/slides-demo.html`,
      { runScripts: 'dangerously', resources: 'usable', pretendToBeVisual: true,
        virtualConsole: vc });
    const w = dom.window;
    w.HTMLCanvasElement.prototype.getContext = () =>
      new Proxy({}, { get: () => () => ({ width: 10 }) });
    await new Promise(r => setTimeout(r, 4000));
    const el = w.document.getElementById('mipd-missing');
    const shown = !!(el && el.style.display === 'block');
    const pass = shown === expect;
    if (!pass) fails++;
    console.log(`${pass ? 'pass' : 'FAIL'}  ${label}: banner ${shown ? 'SHOWN' : 'hidden'}` +
                ` (expected ${expect ? 'SHOWN' : 'hidden'})`);
    w.close(); s.close();
  }
  console.log(fails === 0 ? '\nSELF-CHECK VERIFIED' : `\n${fails} FAILED`);
  process.exit(fails ? 1 : 0);
})();
