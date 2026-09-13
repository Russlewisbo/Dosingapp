/* End-to-end check of the slide deck.

   Extracts every mipd-lab.html widget URL from the RENDERED reveal.js
   deck and boots the app with each one, confirming the deck's embeds
   actually work rather than merely being syntactically present. Catches
   the realistic failure: a typo'd model id or target id in a slide URL,
   which would silently fall back to defaults and show the wrong figure
   in a lecture.
   Run: node test-slides.cjs   (after: quarto render slides-demo.qmd)    */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const APP = 'mipd-lab.html';
const DECK = 'slides-demo.html';
let fails = 0;
const ok = (n, c, d) => {
  if (!c) { fails++; console.log('FAIL  ' + n + (d ? '  ' + d : '')); }
  else console.log('pass  ' + n + (d ? '  ' + d : ''));
};

if (!fs.existsSync(DECK)) {
  console.log('SKIP: ' + DECK + ' not rendered');
  process.exit(0);
}
const HTML = fs.readFileSync(APP, 'utf8');
const deck = fs.readFileSync(DECK, 'utf8');

/* Pull widget query strings out of the rendered deck, un-escaping the
   HTML entities Quarto writes, and drop the ones inside code blocks
   (those are the documentation examples, with literal "..."). */
const urls = [...new Set(
  (deck.match(/mipd-lab\.html\?[^"'<\s]+/g) || [])
    .map(u => u.replace(/&amp;/g, '&').replace(/&#39;/g, "'"))
    .filter(u => !u.includes('...') && !u.includes('</span'))
)];
ok('deck contains widget embeds', urls.length >= 5, `${urls.length} URLs`);

function ctxMock() {
  const rec = { strokes: 0, texts: 0 };
  const noop = () => {};
  const c = { canvas: null, setTransform: noop, clearRect: () => { rec.strokes = 0; rec.texts = 0; },
    beginPath: noop, moveTo: noop, lineTo: noop, closePath: noop, arc: noop,
    save: noop, restore: noop, translate: noop, rotate: noop, setLineDash: noop,
    measureText: () => ({ width: 10 }), fill: noop,
    stroke: () => { rec.strokes++; }, fillText: () => { rec.texts++; }, _rec: rec };
  ['font','fillStyle','strokeStyle','lineWidth','textAlign','textBaseline','lineJoin','lineCap']
    .forEach(k => Object.defineProperty(c, k, { get: () => '', set: () => {} }));
  return c;
}

// Read the valid model ids out of the app itself rather than hardcoding
// them, so adding a model to the library cannot make this test stale.
const KNOWN_MODELS = require('./models.js').MODELS.map(m => m.id);

urls.forEach(u => {
  const qs = '?' + u.split('?')[1];
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', virtualConsole: vc, pretendToBeVisual: true,
    url: 'http://localhost/mipd-lab.html' + qs
  });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = function () {
    if (!this.__ctx) { this.__ctx = ctxMock(); this.__ctx.canvas = this; }
    return this.__ctx;
  };
  Object.defineProperty(w.HTMLElement.prototype, 'clientWidth',
    { get() { return 900; }, configurable: true });
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  const d = w.document;

  const params = new w.URLSearchParams(qs);
  const wantModel = params.get('model');
  const wantTarget = params.get('target');
  const short = qs.slice(0, 52) + (qs.length > 52 ? '…' : '');

  const gotModel = d.getElementById('model').value;
  const gotTarget = d.getElementById('target').value;
  const drew = d.getElementById('cvPta').__ctx._rec.strokes > 3 ||
               d.getElementById('cvConc').__ctx._rec.strokes > 3;

  let problems = [];
  if (errors.length) problems.push('script error: ' + errors[0]);
  // A model id in the URL that does not exist would silently fall back.
  if (wantModel) {
    if (KNOWN_MODELS.indexOf(wantModel) < 0) problems.push('unknown model id ' + wantModel);
    else if (gotModel !== wantModel) problems.push(`model ${wantModel} -> ${gotModel}`);
  }
  if (wantTarget && gotTarget !== wantTarget) {
    problems.push(`target ${wantTarget} -> ${gotTarget} (not valid for this model)`);
  }
  if (!drew) problems.push('nothing drawn');
  // Regimen params must reach the simulation.
  if (params.get('tinf') && d.getElementById('wTinf') &&
      parseFloat(d.getElementById('wTinf').value) !== parseFloat(params.get('tinf'))) {
    problems.push('tinf not applied');
  }
  ok('embed boots: ' + short, problems.length === 0, problems.join('; '));
});

console.log(fails === 0 ? '\nSLIDE EMBED TESTS PASSED' : `\n${fails} SLIDE EMBED TEST(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
