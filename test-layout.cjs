/* Layout geometry audit.

   A real browser screenshot is not reachable from this sandbox (the
   Chromium download redirects to a denylisted host), so instead of
   looking at the rendering, this test records the coordinates of every
   canvas drawing operation and checks the geometry directly:

     - no text is clipped by the canvas edges
     - no plotted vertex falls outside the canvas
     - x-axis tick labels do not overlap each other
     - the data series stay inside the axes frame
     - the widget renders at the larger font size without collisions

   That covers the failure modes a visual check would have caught.
   Run: node test-layout.cjs                                            */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');
const HTML = fs.readFileSync('mipd-lab.html', 'utf8');

let fails = 0;
const ok = (name, cond, detail) => {
  if (!cond) { fails++; console.log('FAIL  ' + name + (detail ? '  ' + detail : '')); }
  else console.log('pass  ' + name + (detail ? '  ' + detail : ''));
};

/* A context mock that tracks drawing state, the affine transform and the
   geometry of every operation.

   Transform tracking is load-bearing: rotated y-axis titles are emitted
   at coordinates in a translated+rotated frame, so a mock that ignores
   translate()/rotate() reports them as far off-canvas. Records are also
   cleared on clearRect(), because the app legitimately re-renders a
   canvas many times and stale ops would look like collisions. */
function recCtx(canvas) {
  const st = { font: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
               textAlign: 'start', textBaseline: 'alphabetic' };
  // Affine transform as [a,b,c,d,e,f] (canvas convention).
  let T = [1, 0, 0, 1, 0, 0];
  const stack = [];
  const R = { texts: [], verts: [], arcs: [] };
  let cur = [];
  const fontPx = () => {
    const m = /(\d+(?:\.\d+)?)px/.exec(st.font);
    return m ? parseFloat(m[1]) : 12;
  };
  const xf = (x, y) => [T[0] * x + T[2] * y + T[4], T[1] * x + T[3] * y + T[5]];
  const mul = (m) => {
    T = [T[0] * m[0] + T[2] * m[1], T[1] * m[0] + T[3] * m[1],
         T[0] * m[2] + T[2] * m[3], T[1] * m[2] + T[3] * m[3],
         T[0] * m[4] + T[2] * m[5] + T[4], T[1] * m[4] + T[3] * m[5] + T[5]];
  };
  const c = {
    _rec: R, _state: st, canvas,
    // The app sets the DPR transform via setTransform; treat it as the
    // base frame so recorded coordinates stay in CSS pixels.
    setTransform() { T = [1, 0, 0, 1, 0, 0]; },
    clearRect() { R.texts.length = 0; R.verts.length = 0; R.arcs.length = 0; },
    save() { stack.push(T.slice()); },
    restore() { if (stack.length) T = stack.pop(); },
    translate(x, y) { mul([1, 0, 0, 1, x, y]); },
    rotate(a) { mul([Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0]); },
    setLineDash() {}, closePath() {},
    measureText(s) { return { width: String(s).length * fontPx() * 0.55 }; },
    beginPath() { cur = []; },
    moveTo(x, y) { cur.push(xf(x, y)); },
    lineTo(x, y) { cur.push(xf(x, y)); },
    arc(x, y, r) { const p = xf(x, y); R.arcs.push({ x: p[0], y: p[1], r }); },
    fill() { R.verts.push(...cur); },
    stroke() { R.verts.push(...cur); },
    fillText(s, x, y) {
      const fpx = fontPx(), w = String(s).length * fpx * 0.55;
      // Untransformed bounding box from align + baseline...
      let lx = x;
      if (st.textAlign === 'center') lx = x - w / 2;
      else if (st.textAlign === 'right') lx = x - w;
      let ty = y, by = y;
      if (st.textBaseline === 'top') { ty = y; by = y + fpx; }
      else if (st.textBaseline === 'middle') { ty = y - fpx / 2; by = y + fpx / 2; }
      else { ty = y - fpx; by = y; }
      // ...then transform its four corners into device space.
      const pts = [xf(lx, ty), xf(lx + w, ty), xf(lx, by), xf(lx + w, by)];
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      const rotated = Math.abs(T[1]) > 1e-9 || Math.abs(T[2]) > 1e-9;
      R.texts.push({ s: String(s),
                     x0: Math.min(...xs), x1: Math.max(...xs),
                     y: (Math.min(...ys) + Math.max(...ys)) / 2,
                     y0: Math.min(...ys), y1: Math.max(...ys),
                     fpx, rotated,
                     align: st.textAlign, baseline: st.textBaseline });
    }
  };
  ['font', 'fillStyle', 'strokeStyle', 'lineWidth', 'textAlign', 'textBaseline',
   'lineJoin', 'lineCap'].forEach(k => {
    Object.defineProperty(c, k, {
      get() { return st[k]; }, set(v) { st[k] = v; }
    });
  });
  return c;
}

function boot(search, width) {
  const vc = new VirtualConsole();
  const errors = [];
  vc.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    url: 'http://localhost/mipd-lab.html' + (search || ''),
    virtualConsole: vc, pretendToBeVisual: true
  });
  const w = dom.window;
  w.HTMLCanvasElement.prototype.getContext = function () {
    if (!this.__ctx) this.__ctx = recCtx(this);
    return this.__ctx;
  };
  Object.defineProperty(w.HTMLElement.prototype, 'clientWidth', {
    get() { return width || 560; }, configurable: true
  });
  w.document.dispatchEvent(new w.Event('DOMContentLoaded', { bubbles: true }));
  return { w, d: w.document, errors };
}

/* Canvas CSS pixel size: width from clientWidth, height from style. */
function box(cv) {
  return { W: cv.clientWidth, H: parseFloat(cv.style.height) };
}

function audit(label, cv) {
  const { W, H } = box(cv), R = cv.__ctx._rec;
  // 1. text fully inside the canvas (full bounding box, in device space)
  const clipped = R.texts.filter(t =>
    t.x0 < -1 || t.x1 > W + 1 || t.y0 < -1 || t.y1 > H + 1);
  ok(label + ': no text clipped by canvas edges', clipped.length === 0,
     clipped.slice(0, 3).map(t =>
       `"${t.s}" x${t.x0.toFixed(0)}..${t.x1.toFixed(0)} y${t.y0.toFixed(0)}..${t.y1.toFixed(0)}`).join(' '));

  // 2. vertices inside the canvas
  const out = R.verts.filter(([x, y]) =>
    !isFinite(x) || !isFinite(y) || x < -1 || x > W + 1 || y < -1 || y > H + 1);
  ok(label + ': no plotted vertex outside canvas', out.length === 0,
     `${out.length}/${R.verts.length} outside  e.g. ${out.slice(0, 2).map(v => `(${v[0].toFixed(0)},${v[1].toFixed(0)})`).join(' ')}`);

  // 3. no NaN geometry (a silent killer: the curve simply vanishes)
  ok(label + ': no NaN/Infinity coordinates',
     R.verts.every(([x, y]) => isFinite(x) && isFinite(y)));

  // 4. x tick labels must not overlap. Tick labels are the bottom-most
  //    centre-aligned texts; group by y and check horizontal gaps.
  const byY = {};
  R.texts.filter(t => t.align === 'center' && !t.rotated).forEach(t => {
    const k = Math.round(t.y);
    (byY[k] = byY[k] || []).push(t);
  });
  let worstOverlap = 0, worstPair = '';
  Object.keys(byY).forEach(k => {
    const row = byY[k].slice().sort((a, b) => a.x0 - b.x0);
    for (let i = 1; i < row.length; i++) {
      const gap = row[i].x0 - row[i - 1].x1;
      if (gap < worstOverlap) {
        worstOverlap = gap;
        worstPair = `"${row[i - 1].s}" / "${row[i].s}" gap ${gap.toFixed(1)}px`;
      }
    }
  });
  ok(label + ': axis tick labels do not overlap', worstOverlap >= -0.5, worstPair);

  // 5. something was actually drawn
  ok(label + ': axes and data were drawn',
     R.texts.length >= 8 && R.verts.length >= 40,
     `${R.texts.length} texts, ${R.verts.length} vertices`);
  return R;
}

console.log('— full mode, 560px canvases —');
{
  const { d, errors } = boot('?model=pip_kim2022&dose=4000&tau=6&tinf=0.5&mic=16&target=ft100&n=300');
  ok('full mode boots clean', errors.length === 0, errors.slice(0, 1).join());
  audit('PTA plot', d.getElementById('cvPta'));
  audit('conc plot', d.getElementById('cvConc'));
}

console.log('\n— widget mode, larger fonts, 900px canvas —');
{
  const { d } = boot('?mode=widget&model=pip_kim2022&dose=4000&tau=6&tinf=4&mic=16&target=ft100&n=300', 900);
  audit('widget PTA', d.getElementById('cvPta'));
  audit('widget conc', d.getElementById('cvConc'));
}

console.log('\n— narrow embed, 380px (worst case for label crowding) —');
{
  const { d } = boot('?mode=widget&panel=pta&model=van_thomson2009&target=auc400&mic=1&n=300', 380);
  audit('narrow PTA', d.getElementById('cvPta'));
}

console.log('\n— log concentration axis —');
{
  const { d } = boot('?model=pip_udy2015&dose=4000&tau=6&tinf=0.33&mic=16&target=ft100&logy=1&n=300');
  const R = audit('log-y conc', d.getElementById('cvConc'));
  ok('log-y: axis labels are decade values',
     R.texts.some(t => /^(0\.1|1|10|100|1000)$/.test(t.s)),
     R.texts.map(t => t.s).filter(s => /^[\d.]+$/.test(s)).slice(0, 8).join(','));
}

console.log('\n— three-regimen comparison —');
{
  const { w, d } = boot('?model=pip_kim2022&n=250');
  const add = d.getElementById('addReg');
  add.dispatchEvent(new w.Event('click', { bubbles: true }));
  add.dispatchEvent(new w.Event('click', { bubbles: true }));
  audit('3-regimen PTA', d.getElementById('cvPta'));
  const rows = d.querySelectorAll('#summary tbody tr').length;
  ok('three regimens in summary table', rows === 3, `${rows} rows`);
}

console.log('\n— whole-course view (many more x ticks than one interval) —');
{
  const { d } = boot('?model=mem_gijsen2021&dose=1000&tau=8&tinf=0.5&mic=2&target=ft100&whole=1&n=250');
  audit('whole-course conc', d.getElementById('cvConc'));
}
{
  // Worst case for tick crowding: a long course in the narrow widget width.
  const { d } = boot('?mode=widget&panel=conc&model=van_thomson2009&target=auc400&mic=1' +
                     '&dose=1000&tau=12&tinf=1&ndoses=20&whole=1&n=200', 380);
  audit('narrow 20-dose course', d.getElementById('cvConc'));
}
{
  // Log y-axis over a whole course, where early concentrations are near zero.
  const { d } = boot('?model=mem_ojeanson2021&dose=1000&tau=8&tinf=0.5&mic=2&target=ft100' +
                     '&whole=1&logy=1&n=250');
  audit('whole-course log-y', d.getElementById('cvConc'));
}

console.log('\n— MAP individual forecast overlay —');
{
  /* The overlay was previously excluded from the y-scale, so an
     individual whose peaks exceed the population band was clipped at the
     top of the axis. This boots a fit with deliberately high
     concentrations and audits the resulting geometry. */
  const { w, d } = boot('?model=van_thomson2009&target=auc400&mic=1' +
                        '&dose=1000&tau=12&tinf=1&n=200');
  d.getElementById('tdmDose').value = '1000';
  d.getElementById('tdmTau').value = '12';
  d.getElementById('tdmTinf').value = '1';
  d.getElementById('tdmN').value = '4';
  d.getElementById('addTdm').dispatchEvent(new w.Event('click', { bubbles: true }));
  const setRow = (i, t, c) => {
    const inp = d.querySelectorAll('#tdmRows tr')[i].querySelectorAll('input');
    inp[0].value = String(t); inp[0].dispatchEvent(new w.Event('input', { bubbles: true }));
    inp[1].value = String(c); inp[1].dispatchEvent(new w.Event('input', { bubbles: true }));
  };
  setRow(0, 25, 55);
  setRow(1, 35, 34);
  d.getElementById('runMap').dispatchEvent(new w.Event('click', { bubbles: true }));
  ok('MAP fit produced an individual estimate',
     /CL/.test(d.getElementById('mapOut').textContent));
  audit('MAP overlay, one interval', d.getElementById('cvConc'));

  const pw = d.getElementById('plotWhole');
  pw.checked = true;
  pw.dispatchEvent(new w.Event('change', { bubbles: true }));
  audit('MAP overlay, whole course', d.getElementById('cvConc'));
}

console.log('\n— newly added models —');
['mem_li2006', 'mem_ehmann2019', 'pip_klastrup2020', 'cef_nicasio2009'].forEach(id => {
  const { d } = boot('?model=' + id + '&n=200');
  audit(id + ' conc', d.getElementById('cvConc'));
  audit(id + ' pta', d.getElementById('cvPta'));
});

console.log('\n— aminoglycoside modules (peaks are an order of magnitude above beta-lactam troughs) —');
{
  const { d } = boot('?preset=gen-od&n=300');
  audit('gentamicin once-daily, 3 regimens', d.getElementById('cvConc'));
  audit('gentamicin once-daily PTA', d.getElementById('cvPta'));
}
{
  // Amikacin at MIC 4 puts the MIC line far below a 60 mg/L peak, which
  // is the widest dynamic range any model in the library produces.
  const { d } = boot('?preset=amk-icu&logy=1&n=300');
  audit('amikacin log-y, wide range', d.getElementById('cvConc'));
}
{
  const { d } = boot('?mode=widget&panel=conc&preset=gen-renal&whole=1&n=250', 380);
  audit('narrow widget, q48h whole course', d.getElementById('cvConc'));
}
{
  const { d } = boot('?model=tob_hennig2013&dose=560&tau=24&tinf=0.5&mic=1&target=od2&n=300');
  audit('tobramycin single regimen', d.getElementById('cvConc'));
}

console.log('\n\u2014 fitted-period view (population band, MAP individual and sample points) \u2014');
{
  const fitBoot = (q, rows, width) => {
    const b = boot(q, width);
    const { w, d } = b;
    const ev = (el, t) => el.dispatchEvent(new w.Event(t, { bubbles: true }));
    const sv = (sel, v) => { const e = d.querySelector(sel); e.value = v; ev(e, 'input'); };
    sv('#tdmDose', 1000); sv('#tdmTau', 12); sv('#tdmTinf', 1); sv('#tdmN', 4);
    rows.forEach((r, i) => {
      if (i > 0) ev(d.getElementById('addTdm'), 'click');
      sv(`[data-t="${i}"]`, r[0]); sv(`[data-c="${i}"]`, r[1]);
    });
    ev(d.getElementById('runMap'), 'click');
    return d;
  };
  const Q = '?model=van_thomson2009&target=auc400&mic=1&dose=1000&tau=12&tinf=1&n=300';

  {
    const d = fitBoot(Q, [[11.5, 9], [2, 26]]);
    audit('fitted period, typical patient', d.getElementById('cvConc'));
  }
  {
    // A sample far ABOVE the population band: the y-axis must include the
    // observations, or the point is clipped off the top of the canvas —
    // the same defect the individual curve had before it was scaled in.
    const d = fitBoot(Q, [[11.5, 18], [2, 42]]);
    audit('fitted period, sample above the band', d.getElementById('cvConc'));
  }
  {
    // Log axis with a low trough: the band floor and the points both have
    // to survive the log transform.
    const d = fitBoot(Q + '&logy=1', [[11.5, 1.2], [2, 22]]);
    audit('fitted period, log y with a low trough', d.getElementById('cvConc'));
  }
  {
    const d = fitBoot('?mode=widget&panel=conc&model=van_thomson2009&target=auc400&mic=1&dose=1000&tau=12&tinf=1&n=200',
                      [[11.5, 9], [2, 26]], 380);
    audit('fitted period at 380 px', d.getElementById('cvConc'));
  }
}

console.log(fails === 0 ? '\nLAYOUT AUDIT PASSED' : `\n${fails} LAYOUT CHECK(S) FAILED`);
process.exit(fails === 0 ? 0 : 1);
