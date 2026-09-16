/* =====================================================================
   app.js — UI, canvas plotting and URL-parameter wiring for MIPD Lab.
   Depends on PKPD (pkpd-core.js) and PKPD_MODELS (models.js).
   No external libraries, no network calls: the built HTML file is fully
   self-contained so it works offline inside a slide deck.
   ===================================================================== */
(function () {
  'use strict';
  var P = window.PKPD, M = window.PKPD_MODELS;
  var $ = function (id) { return document.getElementById(id); };

  var COLORS = ['#0072B2', '#E69F00', '#009E73'];
  var MICCOL = '#D55E00', BAYESCOL = '#CC79A7';

  /* ---------------- URL parameters ---------------- */
  var Q = (function () {
    var o = {}, s = window.location.search.replace(/^\?/, '');
    if (!s) return o;
    s.split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('='), k = i < 0 ? kv : kv.slice(0, i),
          v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
      o[k] = v;
    });
    return o;
  })();
  var WIDGET = Q.mode === 'widget';
  var num = function (v, d) { var x = parseFloat(v); return isFinite(x) ? x : d; };
  var bool = function (v, d) {
    if (v == null) return d;
    return v === '1' || v === 'true' || v === 'yes';
  };

  /* ---------------- state ---------------- */
  var S = {
    modelId: Q.model || 'pip_kim2022',
    regimens: [],
    targetId: Q.target || null,
    mic: null,
    ptaThresh: num(Q.pta, 90),
    n: num(Q.n, WIDGET ? 600 : 1000),
    seed: num(Q.seed, 20250101),
    logy: bool(Q.logy, false),
    // When a MAP fit exists, plot the period the samples came from
    // rather than the forecast window: the population curve, the
    // individual curve and the observations only sit on a common
    // time base there, and without the observations a student
    // cannot see WHY the two curves separated.
    fitView: bool(Q.fitview, true),
    // null = dose out to steady state automatically
    nDoses: Q.ndoses ? Math.max(1, num(Q.ndoses, 0)) : null,
    evalDose: Q.evaldose ? Math.max(1, num(Q.evaldose, 0)) : null,
    plotWhole: bool(Q.whole, false),
    // Bayesian forecasting is on by default but can be switched off,
    // which hides the overlay without discarding the fit.
    bayes: bool(Q.bayes, true),
    cov: {}
  };

  function model() {
    var m = null;
    M.MODELS.forEach(function (x) { if (x.id === S.modelId) m = x; });
    return m || M.MODELS[0];
  }
  function target() {
    var m = model(), t = null;
    m.targets.forEach(function (x) { if (x.id === S.targetId) t = x; });
    return t || m.targets[0];
  }

  /* ---------------- canvas plotting ----------------
     A small axes/line/band renderer. Deliberately hand-rolled: a CDN
     charting library would break an offline slide deck.              */
  function Plot(canvas, opts) {
    opts = opts || {};
    var dpr = window.devicePixelRatio || 1,
        cssW = canvas.clientWidth || 520,
        cssH = opts.height || (WIDGET ? 330 : 270);
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    var g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);
    var fs = WIDGET ? 13 : 11;
    this.g = g; this.W = cssW; this.H = cssH; this.fs = fs;
    this.pad = { l: WIDGET ? 56 : 50, r: 12, t: 10, b: WIDGET ? 44 : 38 };
    this.xlog = !!opts.xlog; this.ylog = !!opts.ylog;
  }
  Plot.prototype.setScale = function (x0, x1, y0, y1) {
    this.x0 = x0; this.x1 = x1; this.y0 = y0; this.y1 = y1;
  };
  Plot.prototype.px = function (x) {
    var a = this.xlog ? Math.log10(Math.max(1e-9, x)) : x,
        b = this.xlog ? Math.log10(Math.max(1e-9, this.x0)) : this.x0,
        c = this.xlog ? Math.log10(Math.max(1e-9, this.x1)) : this.x1;
    return this.pad.l + ((a - b) / (c - b)) * (this.W - this.pad.l - this.pad.r);
  };
  Plot.prototype.py = function (y) {
    var a = this.ylog ? Math.log10(Math.max(1e-9, y)) : y,
        b = this.ylog ? Math.log10(Math.max(1e-9, this.y0)) : this.y0,
        c = this.ylog ? Math.log10(Math.max(1e-9, this.y1)) : this.y1;
    return this.H - this.pad.b - ((a - b) / (c - b)) * (this.H - this.pad.t - this.pad.b);
  };
  Plot.prototype.axes = function (xlab, ylab, xticks, yticks) {
    var g = this.g, i;
    // Tick arrays may be plain numbers or {v,l} objects; normalise once so
    // every consumer below (gridlines included) sees a numeric value. A
    // raw object reaching py() yields log10(object) = NaN on a log axis,
    // which silently drops the gridline.
    function norm(ts) {
      return ts.map(function (t) {
        return (t != null && typeof t === 'object')
          ? { v: t.v, l: t.l != null ? t.l : String(t.v) }
          : { v: t, l: String(t) };
      });
    }
    xticks = norm(xticks); yticks = norm(yticks);
    g.font = this.fs + 'px -apple-system,Segoe UI,Roboto,sans-serif';
    g.lineWidth = 1;
    // gridlines
    g.strokeStyle = '#eef1f4';
    yticks.forEach(function (t) {
      g.beginPath(); g.moveTo(this.pad.l, this.py(t.v));
      g.lineTo(this.W - this.pad.r, this.py(t.v)); g.stroke();
    }, this);
    // frame
    g.strokeStyle = '#c8cfd6';
    g.beginPath();
    g.moveTo(this.pad.l, this.pad.t); g.lineTo(this.pad.l, this.H - this.pad.b);
    g.lineTo(this.W - this.pad.r, this.H - this.pad.b); g.stroke();
    // ticks + labels
    g.fillStyle = '#4a5158'; g.textAlign = 'center'; g.textBaseline = 'top';
    xticks.forEach(function (t) {
      var x = this.px(t.v);
      g.beginPath(); g.moveTo(x, this.H - this.pad.b);
      g.lineTo(x, this.H - this.pad.b + 4); g.stroke();
      g.fillText(t.l, x, this.H - this.pad.b + 6);
    }, this);
    g.textAlign = 'right'; g.textBaseline = 'middle';
    yticks.forEach(function (t) {
      var y = this.py(t.v);
      g.beginPath(); g.moveTo(this.pad.l - 4, y); g.lineTo(this.pad.l, y); g.stroke();
      g.fillText(t.l, this.pad.l - 7, y);
    }, this);
    // axis titles
    g.fillStyle = '#15181c';
    g.font = '600 ' + this.fs + 'px -apple-system,Segoe UI,Roboto,sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'bottom';
    g.fillText(xlab, this.pad.l + (this.W - this.pad.l - this.pad.r) / 2, this.H - 3);
    g.save();
    g.translate(11, this.pad.t + (this.H - this.pad.t - this.pad.b) / 2);
    g.rotate(-Math.PI / 2); g.textBaseline = 'top';
    g.fillText(ylab, 0, 0);
    g.restore();
  };
  Plot.prototype.band = function (xs, los, his, color) {
    var g = this.g, i;
    g.beginPath();
    g.moveTo(this.px(xs[0]), this.py(los[0]));
    for (i = 1; i < xs.length; i++) g.lineTo(this.px(xs[i]), this.py(los[i]));
    for (i = xs.length - 1; i >= 0; i--) g.lineTo(this.px(xs[i]), this.py(his[i]));
    g.closePath(); g.fillStyle = color; g.fill();
  };
  Plot.prototype.line = function (xs, ys, color, w, dash) {
    var g = this.g;
    g.save();
    g.beginPath(); g.lineWidth = w || 2; g.strokeStyle = color;
    g.lineJoin = 'round'; g.lineCap = 'round';
    if (dash) g.setLineDash(dash);
    for (var i = 0; i < xs.length; i++) {
      var X = this.px(xs[i]), Y = this.py(ys[i]);
      if (i === 0) g.moveTo(X, Y); else g.lineTo(X, Y);
    }
    g.stroke(); g.restore();
  };
  Plot.prototype.hline = function (y, color, w, dash) {
    this.line([this.x0, this.x1], [y, y], color, w || 1.5, dash || [5, 4]);
  };
  Plot.prototype.vline = function (x, color, w, dash) {
    this.line([x, x], [this.y0, this.y1], color, w || 1.5, dash || [5, 4]);
  };
  Plot.prototype.points = function (xs, ys, color, r) {
    var g = this.g;
    for (var i = 0; i < xs.length; i++) {
      g.beginPath();
      g.arc(this.px(xs[i]), this.py(ys[i]), r || 4, 0, 2 * Math.PI);
      g.fillStyle = color; g.fill();
      g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.stroke();
    }
  };
  Plot.prototype.text = function (s, x, y, color, align, bold) {
    var g = this.g;
    g.font = (bold ? '600 ' : '') + this.fs + 'px -apple-system,Segoe UI,Roboto,sans-serif';
    g.fillStyle = color || '#15181c';
    g.textAlign = align || 'left'; g.textBaseline = 'middle';
    g.fillText(s, x, y);
  };

  function niceTicks(lo, hi, want) {
    var span = hi - lo;
    if (!(span > 0)) return [lo];
    var raw = span / (want || 5),
        mag = Math.pow(10, Math.floor(Math.log10(raw))),
        norm = raw / mag,
        step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag,
        start = Math.ceil(lo / step) * step, out = [];
    for (var v = start; v <= hi + step * 1e-9; v += step) {
      out.push(Math.abs(v) < 1e-12 ? 0 : parseFloat(v.toPrecision(12)));
    }
    return out;
  }

  /* ---------------- covariate handling ---------------- */
  /* Each model declares which renal-function equation its clearance
     covariate was estimated against. Substituting a different equation
     is a silent misuse, so the mapping is explicit per model and the
     computed value is labelled with the equation used in the readout. */
  var RENAL_LABEL = {
    cg: 'CLcr (Cockcroft-Gault)',
    cysc: 'eGFR (CKD-EPI cystatin C)',
    ckdepi: 'eGFR (CKD-EPI creatinine)',
    mdrd: 'GFR (MDRD, 4-variable)',
    jelliffe: 'CLcr (Jelliffe 1973, BSA-corrected)'
  };
  function renalOf(m, cIn) {
    var c = cIn || S.cov;
    if (m.renal === 'cysc') {
      return { egfr: P.ckdEpiCysC({ cysc: c.cysc, age: c.age, sex: c.sex }),
               kind: 'cysc' };
    }
    if (m.renal === 'ckdepi') {
      return { egfr: P.ckdEpiCr({ scr: c.scr, scrUnit: c.scrUnit,
                                  age: c.age, sex: c.sex }), kind: 'ckdepi' };
    }
    if (m.renal === 'jelliffe') {
      // Rescaled to the patient's own BSA, because the model's covariate
      // is an absolute clearance rather than a per-1.73m2 value.
      return { crcl: P.jelliffe({ scr: c.scr, scrUnit: c.scrUnit, age: c.age,
                                  sex: c.sex, wt: c.wt, ht: c.ht,
                                  absolute: true }), kind: 'jelliffe' };
    }
    if (m.renal === 'mdrd') {
      return { egfr: P.mdrd({ scr: c.scr, scrUnit: c.scrUnit,
                              age: c.age, sex: c.sex }), kind: 'mdrd' };
    }
    return { crcl: P.cockcroftGault({ wt: c.wt, age: c.age, sex: c.sex,
                                      scr: c.scr, scrUnit: c.scrUnit }),
             kind: 'cg' };
  }
  function covFull(mIn, covIn) {
    var m = mIn || model(), src = covIn || S.cov, c = {}, k;
    for (k in src) if (Object.prototype.hasOwnProperty.call(src, k)) c[k] = src[k];
    var r = renalOf(m, src);
    if (r.crcl != null) c.crcl = r.crcl;
    if (r.egfr != null) c.egfr = r.egfr;
    // Fat-free mass (Janmahasatian) is a derived size descriptor, not an
    // entered covariate: Hennig 2013 scales every parameter by it.
    c.ffm = P.ffmJanmahasatian({ wt: c.wt, ht: c.ht, sex: c.sex });
    return c;
  }

  /* Some models carry covariate-dependent IIV (Kim: Vc IIV differs on
     ECMO). Build a per-render shallow clone with the right omegas. */
  /* ------------------------------------------------------------------
     Which covariates actually move THIS model's parameters?

     Determined by perturbing each covariate and re-evaluating the
     model's own params() function, rather than by trusting the
     hand-written `covariates` list. Two reasons that matters:

       - The declared list says which inputs to SHOW. It cannot say what
         each one does, and the two drift apart silently. Weight, for
         example, is entered for every model, but for Udy and Klastrup it
         only moves Cockcroft-Gault clearance while for Li it also scales
         the central volume — the user cannot tell those apart from the
         form.
       - A covariate a model uses but forgot to declare would be hidden,
         leaving the user unable to set a value that is silently affecting
         their results. Detection makes that a testable condition.

     Returns { key: ['CL','V1',...] }, empty array meaning no effect at
     the CURRENT settings — which is itself informative. In the O'Jeanson
     model, for instance, semi-continuous (intermittent) dialysis fixes
     clearance at 11.0 L/h independently of GFR and of residual diuresis,
     so both of those inputs correctly report no effect under that
     modality while they do act under continuous dialysis.
     ------------------------------------------------------------------ */
  var COV_PROBE = {
    wt:  function (c) { c.wt = c.wt * 1.25 + 3; },
    age: function (c) { c.age = Math.min(95, c.age * 1.2 + 5); },
    ht:  function (c) { c.ht = c.ht + 10; },
    sex: function (c) { c.sex = c.sex === 'F' ? 'M' : 'F'; },
    scr: function (c) { c.scr = c.scr * 1.5 + 0.2; },
    cysc: function (c) { c.cysc = c.cysc * 1.5 + 0.2; },
    alb: function (c) { c.alb = (c.alb || 2.8) + 1.2; },
    rd:  function (c) { c.rd = (c.rd || 0) + 900; },
    ecmo: function (c) { c.ecmo = !c.ecmo; },
    rrt: function (c) { c.rrt = !c.rrt; },
    dialysis: function (c) { c.dialysis = c.dialysis === 'cont' ? 'none' : 'cont'; },
    trauma: function (c) { c.trauma = !c.trauma; },
    sepsis: function (c) { c.sepsis = !c.sepsis; }
  };
  var PARAM_KEYS = ['CL', 'V1', 'Q', 'V2'];

  function activeCovariates(m) {
    var base;
    try { base = m.params(covFull(m, S.cov)); } catch (e) { return {}; }
    var out = {};
    Object.keys(COV_PROBE).forEach(function (k) {
      var alt = {}, kk;
      for (kk in S.cov) if (Object.prototype.hasOwnProperty.call(S.cov, kk)) alt[kk] = S.cov[kk];
      COV_PROBE[k](alt);
      var p;
      try { p = m.params(covFull(m, alt)); } catch (e) { p = null; }
      var hit = [];
      if (p) {
        PARAM_KEYS.forEach(function (pk) {
          if (base[pk] == null && p[pk] == null) return;
          var a = base[pk] || 0, b = p[pk] || 0;
          if (Math.abs(a - b) > 1e-9 * Math.max(1, Math.abs(a))) hit.push(pk);
        });
      }
      out[k] = hit;
    });
    return out;
  }

  var COV_LABEL = {
    wt: 'Weight', age: 'Age', ht: 'Height', sex: 'Sex',
    scr: 'Creatinine', cysc: 'Cystatin C', alb: 'Albumin',
    rd: 'Residual diuresis', ecmo: 'ECMO', rrt: 'RRT', dialysis: 'Dialysis modality',
    trauma: 'Trauma', sepsis: 'Sepsis'
  };
  var PARAM_LABEL = { CL: 'CL', V1: 'V\u2081', Q: 'Q', V2: 'V\u2082' };

  /* Write the detected effects next to the inputs, so the form states
     what each entered value does for the SELECTED model instead of
     leaving the user to infer it. */
  function annotateCovariates(m) {
    var act = activeCovariates(m), host = $('covEffects');
    LAST_ACTIVE = act;

    Object.keys(COV_PROBE).forEach(function (k) {
      var el = $(k);
      if (!el) return;
      var hit = act[k] || [];
      el.title = hit.length
        ? 'Moves ' + hit.map(function (p) { return PARAM_LABEL[p]; }).join(', ') +
          ' in this model.'
        : 'Entered, but does not change this model\u2019s parameters at the ' +
          'current settings.';
      // A field that does nothing should look like it does nothing.
      el.classList.toggle('inert', hit.length === 0);
      var lab = el.parentNode && el.parentNode.querySelector('label');
      if (lab && COV_LABEL[k]) {
        var base = lab.getAttribute('data-base') || lab.textContent;
        lab.setAttribute('data-base', base);
        lab.innerHTML = base + (hit.length
          ? ' <span class="eff">\u2192 ' +
            hit.map(function (p) { return PARAM_LABEL[p]; }).join(', ') + '</span>'
          : ' <span class="eff off">no effect</span>');
      }
    });

    if (host) {
      var used = Object.keys(act).filter(function (k) { return act[k].length; });
      host.innerHTML =
        '<b>Covariates in this model:</b> ' +
        (used.length
          ? used.map(function (k) {
              return COV_LABEL[k] + ' \u2192 ' +
                act[k].map(function (p) { return PARAM_LABEL[p]; }).join('/');
            }).join(' &middot; ')
          : 'none') +
        (m.renalDisplayOnly
          ? '. This model does not take a creatinine clearance as input: ' +
            'creatinine acts through a ratio to an age- and sex-typical ' +
            'normal value, and size through fat-free mass. The ' +
            (RENAL_LABEL[(renalOf(m) || {}).kind] || 'Cockcroft-Gault') +
            ' figure shown alongside is for orientation only.'
          : '. Renal function is computed with ' +
            (RENAL_LABEL[(renalOf(m) || {}).kind] || 'Cockcroft-Gault') +
            ', so creatinine, age, sex and weight can act through it as ' +
            'well as directly.');
    }
  }

  function modelResolved() {
    var m = model();
    if (typeof m.iivFor !== 'function') return m;
    var clone = {}, k;
    for (k in m) if (Object.prototype.hasOwnProperty.call(m, k)) clone[k] = m[k];
    clone.iiv = m.iivFor(S.cov);
    return clone;
  }

  /* ---------------- regimen UI ---------------- */
  function defaultRegimens() {
    var m = model(), d = m.defaultRegimen;
    if (Q.dose || Q.ci) {
      var list = [];
      if (bool(Q.ci, false)) {
        list.push({ label: 'CI', mode: 'ci', dose24: num(Q.dose24, 16000), on: true });
      } else {
        list.push({ label: 'A', dose: num(Q.dose, d.dose), tau: num(Q.tau, d.tau),
                    tinf: num(Q.tinf, d.tinf), on: true });
      }
      if (Q.dose2) {
        list.push({ label: 'B', dose: num(Q.dose2, d.dose), tau: num(Q.tau2, d.tau),
                    tinf: num(Q.tinf2, d.tinf), on: true });
      }
      if (Q.dose3) {
        list.push({ label: 'C', dose: num(Q.dose3, d.dose), tau: num(Q.tau3, d.tau),
                    tinf: num(Q.tinf3, d.tinf), on: true });
      }
      return list;
    }
    // A model's own default may be a continuous infusion (Klastrup 2020
    // was developed in patients on CI), in which case there is no dose,
    // interval or infusion duration to copy.
    if (d.mode === 'ci') {
      return [{ label: 'A', mode: 'ci', dose24: d.dose24, on: true }];
    }
    return [{ label: 'A', dose: d.dose, tau: d.tau, tinf: d.tinf, on: true }];
  }

  function regLabel(r) {
    if (r.mode === 'ci') return (r.dose24 / 1000) + ' g/24 h CI';
    return (r.dose >= 1000 ? (r.dose / 1000) + ' g' : r.dose + ' mg') +
           ' q' + r.tau + 'h, ' + r.tinf + ' h inf';
  }

  function renderRegimens() {
    var host = $('regimens');
    if (!host) return;
    host.innerHTML = '';
    S.regimens.forEach(function (r, i) {
      var d = document.createElement('div');
      d.style.cssText = 'border-top:1px solid var(--line2);padding-top:8px;margin-top:8px';
      if (i === 0) d.style.cssText = '';
      var swatch = '<span style="display:inline-block;width:11px;height:11px;' +
        'border-radius:3px;background:' + COLORS[i % 3] + ';vertical-align:middle"></span>';
      d.innerHTML =
        '<div class="inline" style="justify-content:space-between;margin-bottom:5px">' +
          '<span style="font-size:.78rem;font-weight:600">' + swatch + ' ' + r.label + '</span>' +
          '<span>' +
            '<label class="inline" style="display:inline-flex;font-size:.72rem">' +
              '<input type="checkbox" data-ci="' + i + '"' + (r.mode === 'ci' ? ' checked' : '') + '> CI</label>' +
            (S.regimens.length > 1 ? ' <button class="mini" data-del="' + i + '">×</button>' : '') +
          '</span>' +
        '</div>' +
        (r.mode === 'ci'
          ? '<div class="row"><div><label>Daily dose (mg/24 h)</label>' +
            '<input type="number" step="500" data-f="dose24" data-i="' + i + '" value="' + (r.dose24 || 16000) + '"></div></div>'
          : '<div class="row r3">' +
            '<div><label>Dose (mg)</label><input type="number" step="250" data-f="dose" data-i="' + i + '" value="' + r.dose + '"></div>' +
            '<div><label>&tau; (h)</label><input type="number" step="1" data-f="tau" data-i="' + i + '" value="' + r.tau + '"></div>' +
            '<div><label>Inf (h)</label><input type="number" step="0.25" data-f="tinf" data-i="' + i + '" value="' + r.tinf + '"></div>' +
            '</div>');
      host.appendChild(d);
    });
    host.querySelectorAll('input[data-f]').forEach(function (el) {
      el.addEventListener('input', function () {
        var i = +el.getAttribute('data-i'), f = el.getAttribute('data-f');
        S.regimens[i][f] = parseFloat(el.value);
        run();
      });
    });
    host.querySelectorAll('input[data-ci]').forEach(function (el) {
      el.addEventListener('change', function () {
        var i = +el.getAttribute('data-ci'), r = S.regimens[i];
        if (el.checked) {
          r.mode = 'ci';
          r.dose24 = r.dose && r.tau ? Math.round((r.dose * 24) / r.tau) : 16000;
        } else {
          delete r.mode;
          var m = model().defaultRegimen;
          r.dose = r.dose || m.dose; r.tau = r.tau || m.tau; r.tinf = r.tinf || m.tinf;
        }
        renderRegimens(); run();
      });
    });
    host.querySelectorAll('button[data-del]').forEach(function (el) {
      el.addEventListener('click', function () {
        S.regimens.splice(+el.getAttribute('data-del'), 1);
        S.regimens.forEach(function (r, j) { r.label = 'ABC'.charAt(j); });
        renderRegimens(); run();
      });
    });
  }

  /* ---------------- selectors ---------------- */
  function drugs() {
    var seen = [], out = [];
    M.MODELS.forEach(function (m) {
      if (seen.indexOf(m.drug) < 0) { seen.push(m.drug); out.push(m.drug); }
    });
    return out;
  }

  function fillSelectors() {
    var dsel = $('drug');
    if (dsel) {
      dsel.innerHTML = drugs().map(function (d) {
        return '<option value="' + d + '">' + d + '</option>';
      }).join('');
      dsel.value = model().drug;
      dsel.onchange = function () {
        var first = null;
        M.MODELS.forEach(function (m) { if (m.drug === dsel.value && !first) first = m; });
        S.modelId = first.id; S.targetId = null;
        syncModel(true); run();
      };
    }
    var msel = $('model');
    if (msel) {
      msel.innerHTML = M.MODELS.filter(function (m) { return m.drug === model().drug; })
        .map(function (m) {
          return '<option value="' + m.id + '">' + m.label + '</option>';
        }).join('');
      msel.value = S.modelId;
      msel.onchange = function () {
        S.modelId = msel.value; S.targetId = null; syncModel(true); run();
      };
    }
    [['target', function (v) { S.targetId = v; }],
     ['wTarget', function (v) { S.targetId = v; }]].forEach(function (pair) {
      var el = $(pair[0]);
      if (!el) return;
      el.innerHTML = model().targets.map(function (t) {
        return '<option value="' + t.id + '">' + t.label + '</option>';
      }).join('');
      el.value = target().id;
      el.onchange = function () { pair[1](el.value); syncTargetSelects(); run(); };
    });
  }
  function syncTargetSelects() {
    ['target', 'wTarget'].forEach(function (id) {
      var el = $(id); if (el) el.value = target().id;
    });
  }

  /* Show only the covariate inputs the selected model actually uses —
     entering a creatinine eGFR into a cystatin-C model is a real misuse. */
  function syncModel(resetDefaults) {
    var m = model();
    if (resetDefaults) {
      S.regimens = [{ label: 'A', dose: m.defaultRegimen.dose, tau: m.defaultRegimen.tau,
                      tinf: m.defaultRegimen.tinf, on: true }];
      if (m.defaultRegimen.mode === 'ci') {
        S.regimens[0] = { label: 'A', mode: 'ci',
                          dose24: m.defaultRegimen.dose24, on: true };
      }
      S.mic = m.defaultMic;
    }
    var usesCysC = m.renal === 'cysc';
    if ($('scrBlock')) $('scrBlock').classList.toggle('hidden', usesCysC);
    if ($('cyscBlock')) $('cyscBlock').classList.toggle('hidden', !usesCysC);
    var has = function (k) { return m.covariates.indexOf(k) >= 0; };
    if ($('ecmoBlock')) $('ecmoBlock').classList.toggle('hidden', !has('ecmo'));
    if ($('rrtBlock')) $('rrtBlock').classList.toggle('hidden', !has('rrt'));
    if ($('dialysisBlock')) $('dialysisBlock').classList.toggle('hidden', !has('dialysis'));
    if ($('rdBlock')) $('rdBlock').classList.toggle('hidden', !has('rd'));
    if ($('albBlock')) $('albBlock').classList.toggle('hidden', !has('alb'));
    if ($('traumaBlock')) $('traumaBlock').classList.toggle('hidden', !has('trauma'));
    if ($('sepsisBlock')) $('sepsisBlock').classList.toggle('hidden', !has('sepsis'));
    annotateCovariates(m);
    if ($('modelCite')) {
      $('modelCite').innerHTML = m.source +
        ' &nbsp;<a href="https://doi.org/' + m.doi + '" target="_blank" rel="noopener">doi</a>' +
        '<br>Fitted to <b>' + m.matrix + '</b>' +
        (m.fu !== 1 ? ', free fraction ' + m.fu : '') + '.';
    }
    if ($('modelNote')) {
      var n = '';
      if (m.note) n += '<div class="note">' + m.note + '</div>';
      if (m.bayesian === false) n += '<div class="note">' + m.bayesianNote + '</div>';
      $('modelNote').innerHTML = n;
    }
    // The card stays visible when the user switches forecasting off (so
    // the switch remains reachable); only its body is disabled. It is
    // hidden outright when the MODEL cannot support forecasting.
    if ($('panelTdm')) $('panelTdm').classList.toggle('hidden', m.bayesian === false);
    var bOn = $('bayesOn');
    if (bOn) {
      bOn.checked = S.bayes;
      bOn.disabled = m.bayesian === false;
    }
    if ($('tdmBody')) $('tdmBody').classList.toggle('off', !S.bayes);
    if ($('bayesState')) {
      $('bayesState').textContent = m.bayesian === false
        ? 'unavailable for this model'
        : (S.bayes ? '' : 'off \u2014 population prediction only');
    }
    fillSelectors();
    renderRegimens();
    if ($('mic')) $('mic').value = S.mic;
    if ($('wMic')) $('wMic').value = S.mic;
    var wl = $('wRenalLab');
    if (wl) wl.textContent = usesCysC ? 'eGFR (cystatin C)' : 'CLcr (mL/min)';
    var wr = $('wRenal');
    if (wr) {
      var r = renalOf(m);
      wr.value = Math.round(r.crcl != null ? r.crcl : r.egfr);
    }
  }

  /* ---------------- rendering ---------------- */
  var LAST = null;

  function run() {
    var m = modelResolved(), cov = covFull(), t = target(),
        mics = M.LADDER, results = [];

    S.regimens.forEach(function (r, i) {
      var reg = r.mode === 'ci'
        ? { mode: 'ci', dose24: r.dose24, duration: 24 * 5 }
        : { dose: r.dose, tau: r.tau, tinf: r.tinf };
      if (r.mode !== 'ci' && S.nDoses) reg.nDoses = S.nDoses;
      var res = P.simulate({
        model: m, cov: cov, regimen: reg, target: t, mics: mics,
        mic: S.mic, n: S.n, seed: S.seed,
        evalDose: S.evalDose || 'last', plotWhole: S.plotWhole,
        nT: S.plotWhole ? 480 : 140, nGrid: 260
      });
      res.color = COLORS[i % 3];
      res.label = regLabel(r);
      results.push(res);
    });
    LAST = { results: results, model: m, target: t, cov: cov };
    drawHeader(results);
    drawPta(results, t);
    drawConc(results, t);
    drawSummary(results, t);
    drawCfr(results);
    drawRenal();
    drawCourseNote(results);
  }

  /* The header was previously written once at start-up, which left it
     naming the wrong drug after a model change. It is derived state and
     belongs in the render path. */
  function drawHeader(results) {
    var m = model(), r0 = results && results[0];
    if ($('title')) {
      $('title').textContent = Q.title || (m.drug + ' \u2014 target attainment');
    }
    if ($('subtitle')) {
      var where = !r0 ? ''
        : (r0.schedule && r0.schedule.ci) ? ' &middot; continuous infusion'
        : (r0.atSteadyState
            ? ' &middot; dose ' + r0.evalDose + ' of ' + r0.nDoses + ' (steady state)'
            : ' &middot; dose ' + r0.evalDose + ' of ' + r0.nDoses + ' (pre\u2013steady state)');
      $('subtitle').innerHTML = m.label + ' &middot; Monte Carlo, n = ' + S.n +
                                ', seed ' + S.seed + where;
    }
  }

  function drawCourseNote(results) {
    var host = $('courseNote'); if (!host) return;
    var r0 = results[0];
    if (!r0 || (r0.schedule && r0.schedule.ci)) {
      host.textContent = 'Continuous infusion: exposure is averaged over the ' +
                         'final 24 h.';
      return;
    }
    var msg = 'Target evaluated over dose ' + r0.evalDose + ' of ' + r0.nDoses +
              ' (' + fmt(r0.tA) + '\u2013' + fmt(r0.tB) + ' h). ';
    msg += r0.atSteadyState
      ? 'This interval is at steady state (\u2265 ' + r0.dosesToSteadyState +
        ' doses needed for this patient).'
      : 'NOT yet steady state \u2014 this patient needs about ' +
        r0.dosesToSteadyState + ' doses to reach it, so attainment here ' +
        'understates the eventual steady-state value.';
    host.textContent = msg;
  }

  function drawPta(results, t) {
    var cv = $('cvPta'); if (!cv) return;
    var pl = new Plot(cv, { xlog: true });
    var mics = M.LADDER;
    pl.setScale(mics[0], mics[mics.length - 1], 0, 100);
    var xt = mics.map(function (v) {
      return { v: v, l: v < 1 ? String(v) : String(v) };
    });
    pl.axes('MIC (mg/L)', 'PTA (%)', xt, niceTicks(0, 100, 5));
    pl.hline(S.ptaThresh, '#9aa3ab', 1.5, [5, 4]);
    pl.text(S.ptaThresh + '%', pl.W - pl.pad.r - 3, pl.py(S.ptaThresh) - 9, '#7c858e', 'right');
    results.forEach(function (r) {
      pl.line(r.pta.map(function (p) { return p.mic; }),
              r.pta.map(function (p) { return p.pta; }), r.color, WIDGET ? 3 : 2.4);
    });
    var leg = $('legPta');
    if (leg) {
      leg.innerHTML = results.map(function (r) {
        var bp = P.pkpdBreakpoint(r.pta, S.ptaThresh);
        return '<span><i style="background:' + r.color + '"></i>' + r.label +
               ' &mdash; breakpoint ' + (bp == null ? '&lt;' + M.LADDER[0] : bp) + ' mg/L</span>';
      }).join('') +
      '<span style="color:var(--ink3)">' + t.label + ' &middot; n=' + S.n + '</span>';
    }
  }

  /* ------------------------------------------------------------------
     The sampled period: population prediction, the MAP individual, and
     the measurements, on one time base.

     This is the picture the forecast view cannot draw. The forecast view
     shows one dosing interval of the regimen being EVALUATED, which is
     usually not the regimen the samples were taken under — so the
     observations have no correct position on it. Here the axis is the
     dosing record itself, absolute from its first dose, which is the
     clock the sample times were entered on.

     The population band and median come from the PRIOR (the model's own
     parameters and variability for this patient's covariates), not from
     the fit — that contrast is the entire teaching point: the band is
     what was predicted before the samples, the individual line is what
     the samples changed it to.
     ------------------------------------------------------------------ */
  function drawFitView(cv, t) {
    var L = LASTMAP, m = modelResolved(), cov = covFull(),
        reg = { dose: L.regimen.dose, tau: L.regimen.tau,
                tinf: L.regimen.tinf, nDoses: L.regimen.nDoses },
        pop = P.simulate({
          model: m, cov: cov, regimen: reg, target: t,
          mics: [S.mic], mic: S.mic, n: S.n, seed: S.seed,
          plotWhole: true, nGrid: 300
        }),
        sched = P.buildSchedule(reg),
        cfInd = P.concFn(L.fit.params, m.ncmt, sched),
        times = pop.times,
        indiv = times.map(function (x) { return cfInd(x); }),
        micLine = S.mic * (t.micMultiplier || 1),
        pl = new Plot(cv, { ylog: S.logy }),
        ymax = 0, i;

    for (i = 0; i < times.length; i++) {
      if (pop.hi[i] > ymax) ymax = pop.hi[i];
      if (indiv[i] > ymax) ymax = indiv[i];
    }
    // The observations must be inside the axis, or a sample above the
    // population band is silently clipped off the top — exactly the
    // failure the individual curve had before it was included here.
    L.samples.forEach(function (s) { if (s.conc > ymax) ymax = s.conc; });
    ymax = Math.max(ymax, micLine * 1.25);

    var ymin = S.logy ? Math.max(0.05, Math.min.apply(null,
          L.samples.map(function (s) { return s.conc; }).concat([micLine])) / 8) : 0,
        tspan = pop.tPlotB;
    pl.setScale(0, tspan, ymin, ymax * 1.06);
    var yt = S.logy
      ? [0.1, 1, 10, 100, 1000].filter(function (v) { return v >= ymin && v <= ymax * 1.06; })
          .map(function (v) { return { v: v, l: String(v) }; })
      : niceTicks(0, ymax * 1.06, 5);
    // The full label overflows a 380 px widget canvas (caught by the
    // layout audit at x 394 on a 380 px width), so the narrow build gets
    // the short form.
    pl.axes(WIDGET ? 'Time from first dose (h)'
                   : 'Time since the first dose of the sampled record (h)',
            'Concentration (mg/L)', niceTicks(0, tspan, 6), yt);

    var clamp = function (v) { return Math.max(ymin, v); };
    pl.band(times, pop.lo.map(clamp), pop.hi.map(clamp), 'rgba(0,114,178,.16)');
    pl.line(times, pop.median.map(clamp), '#0072b2', WIDGET ? 3 : 2.4);
    pl.line(times, indiv.map(clamp), BAYESCOL, WIDGET ? 3.4 : 2.8);
    if (micLine > 0) {
      pl.hline(micLine, MICCOL, 1.8, [6, 4]);
      pl.text((t.micMultiplier ? t.micMultiplier + '\u00d7' : '') + 'MIC ' +
              micLine + ' mg/L', pl.pad.l + 5, pl.py(micLine) - 9, MICCOL, 'left', true);
    }
    pl.points(L.samples.map(function (s) { return s.time; }),
              L.samples.map(function (s) { return clamp(s.conc); }),
              BAYESCOL, WIDGET ? 5 : 4.5);

    var leg = $('legConc');
    if (leg) {
      leg.innerHTML =
        '<span><i style="background:#0072b2"></i>Population prediction ' +
          '(median)</span>' +
        '<span><i class="sw-band" style="background:rgba(0,114,178,.16)"></i>' +
          'Population 90% prediction interval</span>' +
        '<span><i style="background:' + BAYESCOL + '"></i>' +
          'MAP individual</span>' +
        '<span><i style="background:' + BAYESCOL +
          ';border-radius:50%"></i>Measured concentration</span>' +
        (micLine > 0
          ? '<span><i style="background:' + MICCOL + '"></i>' +
            (t.micMultiplier ? t.micMultiplier + '\u00d7' : '') + 'MIC</span>'
          : '');
    }
    var host = $('courseNote');
    if (host) {
      // Quantify the separation rather than leaving it to the eye: the
      // ratio of individual to population clearance is what the samples
      // actually changed, and it is the number a student should take away.
      var kCL = L.fit.params.CL / L.fit.typicalParams.CL,
          dir = kCL > 1 ? 'faster' : 'slower',
          inBand = L.samples.filter(function (s) {
            // Nearest grid point to each observation.
            var j = 0, best = Infinity, q;
            for (q = 0; q < times.length; q++) {
              var dd = Math.abs(times[q] - s.time);
              if (dd < best) { best = dd; j = q; }
            }
            return s.conc >= pop.lo[j] && s.conc <= pop.hi[j];
          }).length;
      host.innerHTML =
        'Showing the <b>sampled period</b>: ' + reg.dose + ' mg q' + reg.tau +
        'h over ' + reg.nDoses + ' dose' + (reg.nDoses === 1 ? '' : 's') +
        ', with the ' + L.samples.length + ' measured concentration' +
        (L.samples.length === 1 ? '' : 's') + ' plotted. The blue band is what ' +
        'the population model predicted for this patient <i>before</i> the ' +
        'samples; the pink line is the individual the samples imply. ' +
        'This patient clears the drug <b>' + fmt(Math.abs(kCL - 1) * 100, 0) +
        '% ' + dir + '</b> than the population typical value (CL ' +
        fmt(L.fit.typicalParams.CL, 2) + ' \u2192 ' + fmt(L.fit.params.CL, 2) +
        ' L/h), and ' + inBand + ' of ' + L.samples.length +
        ' observations fell inside the population 90% interval' +
        (inBand === L.samples.length
          ? ' \u2014 so the prior was already consistent with this patient, and ' +
            'the individual line stays close to the population median.'
          : ' \u2014 which is why the individual line departs from the ' +
            'population median.') +
        ' Untick the box in the forecasting card to see the forecast under ' +
        'the regimen you are evaluating instead.';
    }
    return pop;
  }

  function drawConc(results, t) {
    var cv = $('cvConc'); if (!cv) return;
    if (S.bayes && S.fitView && LASTMAP && LASTMAP.fit) {
      drawFitView(cv, t);
      return;
    }
    var pl = new Plot(cv, { ylog: S.logy });
    var r0 = results[0],
        whole = !!r0.plotWhole,
        // Whole-course plots keep absolute time from the first dose.
        // Single-interval plots are shifted to start at zero — and each
        // regimen by ITS OWN interval start, not by the first regimen's.
        // Comparing q24h against q8h dosed to their own steady states
        // gives them different absolute evaluation windows, so a shared
        // offset threw the shorter-interval curves off the left edge.
        shiftOf = function (r) { return whole ? 0 : r.tA; },
        t0 = shiftOf(r0),
        // In both modes the window must cover the LONGEST regimen on the
        // plot, not the first one: a q48h arm runs twice as far as the
        // q24h arm it is being compared against.
        tspan = results.reduce(function (mx, r) {
          return Math.max(mx, whole ? r.tPlotB : (r.tB - r.tA));
        }, 0),
        ymax = 0;
    results.forEach(function (r) {
      r.hi.forEach(function (v) { if (v > ymax) ymax = v; });
    });

    /* Bayesian individual forecast.
       Built here, on the plot's own schedule and time grid, rather than
       precomputed on a fixed 0-to-tau axis: the earlier version could not
       follow the plot window, so in whole-course view it was compressed
       into the first dosing interval. Generating it from the fitted
       parameters under the DISPLAYED regimen is also the clinically
       meaningful object — what this patient is predicted to do on the
       regimen being evaluated, which is the question MAP forecasting is
       for. It must be computed BEFORE the y-scale is set, or a
       high-clearance individual whose peaks exceed the population band
       is silently clipped at the top of the axis. */
    var indiv = null;
    if (S.bayes && LASTMAP && LASTMAP.fit && results.length === 1) {
      var cfInd = P.concFn(LASTMAP.fit.params, model().ncmt, r0.schedule);
      indiv = r0.times.map(function (x) { return cfInd(x); });
      indiv.forEach(function (v) { if (v > ymax) ymax = v; });
    }
    var micLine = S.mic * (t.micMultiplier || 1);
    ymax = Math.max(ymax, micLine * 1.25);
    var ymin = S.logy ? Math.max(0.05, micLine / 50) : 0;
    pl.setScale(0, tspan, ymin, ymax * 1.06);
    var yt = S.logy
      ? [0.1, 1, 10, 100, 1000].filter(function (v) { return v >= ymin && v <= ymax * 1.06; })
          .map(function (v) { return { v: v, l: String(v) }; })
      : niceTicks(0, ymax * 1.06, 5);
    var xlab = whole
      ? 'Time since first dose (h)'
      : ((r0.schedule && r0.schedule.ci)
          ? 'Time over the final 24 h of infusion (h)'
          : (r0.atSteadyState
              ? 'Time within dosing interval at steady state (h)'
              : 'Time within dosing interval ' + r0.evalDose + ' (h)'));
    pl.axes(xlab, 'Concentration (mg/L)', niceTicks(0, tspan, 6), yt);

    // In whole-course view, mark the interval the reported metrics came
    // from, so the numbers in the summary are traceable to the picture.
    if (whole && r0.tB > r0.tA) {
      pl.vline(r0.tA - t0, '#9aa3ab', 1.2, [4, 4]);
      pl.vline(r0.tB - t0, '#9aa3ab', 1.2, [4, 4]);
      // The evaluated interval is the LAST one by default, so a
      // left-aligned label there runs off the right edge — especially at
      // widget width with a long course. Anchor it inside whichever side
      // has room.
      var xa = pl.px(r0.tA - t0), xb = pl.px(r0.tB - t0),
          roomRight = pl.W - pl.pad.r - xb;
      if (roomRight > 64) {
        pl.text('evaluated', xb + 4, pl.pad.t + 2, '#7c858e', 'left', true);
      } else {
        pl.text('evaluated', xa - 4, pl.pad.t + 2, '#7c858e', 'right', true);
      }
    }

    results.forEach(function (r) {
      var ts = shiftOf(r),
          xs = r.times.map(function (x) { return x - ts; });
      if (results.length === 1) {
        // BOTH edges must be clamped to the axis floor, not just the
        // lower one: a whole-course plot starts at t = 0 where the
        // concentration is exactly zero, and log10(0) puts the upper
        // band edge far off-canvas.
        pl.band(xs, r.lo.map(function (v) { return Math.max(ymin, v); }),
                    r.hi.map(function (v) { return Math.max(ymin, v); }),
                'rgba(0,114,178,.16)');
      }
      pl.line(xs, r.median.map(function (v) { return Math.max(ymin, v); }),
              r.color, WIDGET ? 3 : 2.4);
    });
    // MIC (or 4xMIC) reference line
    if (micLine > 0) {
      pl.hline(micLine, MICCOL, 1.8, [6, 4]);
      pl.text((t.micMultiplier ? t.micMultiplier + '\u00d7' : '') + 'MIC ' +
              micLine + ' mg/L', pl.pad.l + 5, pl.py(micLine) - 9, MICCOL, 'left', true);
    }
    // Bayesian individual overlay, on the same time base as the
    // population curves above.
    if (indiv) {
      pl.line(r0.times.map(function (x) { return x - t0; }),
              indiv.map(function (v) { return Math.max(ymin, v); }),
              BAYESCOL, WIDGET ? 3 : 2.4);
    }
    var leg = $('legConc');
    if (leg) {
      leg.innerHTML =
        results.map(function (r) {
          return '<span><i style="background:' + r.color + '"></i>' + r.label + ' (median)</span>';
        }).join('') +
        (results.length === 1
          ? '<span><i class="sw-band" style="background:rgba(0,114,178,.16)"></i>90% prediction interval</span>'
          : '') +
        '<span><i style="background:' + MICCOL + '"></i>' +
          (t.micMultiplier ? t.micMultiplier + '\u00d7' : '') + 'MIC</span>' +
        // The individual forecast was previously drawn unlabelled, which
        // left an unexplained second line on the plot.
        (indiv
          ? '<span><i style="background:' + BAYESCOL + '"></i>' +
            'MAP individual forecast</span>'
          : '');
    }
  }

  function fmt(x, d) {
    if (x == null || !isFinite(x)) return '—';
    return x.toFixed(d == null ? 1 : d);
  }

  function drawSummary(results, t) {
    var host = $('summary'); if (!host) return;
    var m = model();
    var rows = results.map(function (r) {
      var e = r.exposure,
          pta = r.ptaAtRefMic,
          cls = pta >= S.ptaThresh ? 'ok' : 'bad';
      return '<tr>' +
        '<td><span style="display:inline-block;width:9px;height:9px;border-radius:2px;' +
          'background:' + r.color + '"></span> ' + r.label + '</td>' +
        '<td class="num"><b>' + fmt(pta) + '%</b> <span class="pill ' + cls + '">' +
          (pta >= S.ptaThresh ? 'attained' : 'not attained') + '</span></td>' +
        '<td class="num">' + fmt(e.tAbove.median) + ' (' + fmt(e.tAbove.p5, 0) + '–' + fmt(e.tAbove.p95, 0) + ')</td>' +
        '<td class="num">' + fmt(e.auc24.median, 0) + ' (' + fmt(e.auc24.p5, 0) + '–' + fmt(e.auc24.p95, 0) + ')</td>' +
        '<td class="num">' + fmt(e.cmax.median) + '</td>' +
        '<td class="num">' + (e.peak1h ? fmt(e.peak1h.median) : '\u2014') + '</td>' +
        '<td class="num">' + fmt(e.cmin.median, 2) + '</td>' +
        '<td class="num">' + (P.pkpdBreakpoint(r.pta, S.ptaThresh) == null
            ? '&lt;' + M.LADDER[0] : P.pkpdBreakpoint(r.pta, S.ptaThresh)) + '</td>' +
        '</tr>';
    }).join('');
    host.innerHTML =
      '<div class="big">' + fmt(results[0].ptaAtRefMic) + '%<small> PTA &middot; ' +
        t.label + ' at MIC ' + S.mic + ' mg/L &middot; ' + results[0].label + '</small></div>' +
      '<table style="margin-top:10px"><thead><tr>' +
        '<th>Regimen</th><th class="num">PTA at MIC ' + S.mic + '</th>' +
        '<th class="num">%fT&gt;MIC med (90% PI)</th>' +
        '<th class="num">AUC₀₋₂₄ med (90% PI)</th>' +
        '<th class="num">Cmax</th><th class="num">1-h peak</th>' +
        '<th class="num">Cmin</th>' +
        '<th class="num">Breakpoint</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>' +
      (results[0].components
        ? '<div class="note"><b>Joint target, by component.</b> ' +
          results.map(function (r) {
            return r.label + ' \u2014 ' +
              r.components.map(function (c) {
                return c.label + ': <b>' + fmt(c.pta) + '%</b>';
              }).join(', ') + ' (both together ' + fmt(r.ptaAtRefMic) + '%)';
          }).join('<br>') +
          '<br>The joint figure is the fraction of simulated patients meeting ' +
          'every component at once, so it is lower than any single one \u2014 ' +
          'the patient who reaches the peak may be the one who breaches the ' +
          'trough.</div>'
        : '') +
      '<p class="cite" style="margin:8px 0 0">Exposure metrics are computed over ' +
        // The window is selectable, so this sentence must describe the
        // window actually used rather than assert steady state.
        (results[0].schedule && results[0].schedule.ci
          ? 'the final 24 h of the infusion'
          : 'dose ' + results[0].evalDose + ' of ' + results[0].nDoses +
            (results[0].atSteadyState ? ' (steady state)' : ' (pre–steady state)')) +
        '. AUC and Cmax/Cmin are total drug; the 1-h peak is sampled one hour ' +
        'after the end of the infusion, which is the aminoglycoside TDM ' +
        'convention and runs well below the end-of-infusion Cmax; ' +
        '%fT&gt;MIC uses ' +
        'free drug (fu = ' + m.fu + '). Breakpoint = highest ladder MIC with PTA ≥ ' +
        S.ptaThresh + '%.</p>' +
      // Nonparametric models are sampled on the natural scale, where a
      // draw can be non-physical. Suppressing that would misrepresent
      // how far the simulated population departs from the published one.
      (results[0].rejectedFraction > 0.001
        ? '<p class="note" style="margin-top:8px">Nonparametric sampling: ' +
          fmt(results[0].rejectedFraction * 100, 0) + '% of multivariate-normal ' +
          'draws from the published covariance matrix were non-physical (a ' +
          'negative rate constant or volume) and were rejected and redrawn. ' +
          'The simulated population is therefore a truncated normal, not ' +
          'exactly the nonparametric distribution the authors fitted.</p>'
        : '');
  }

  function parseMicDist() {
    var el = $('micDist');
    if (!el || !el.value.trim()) return null;
    var out = [];
    el.value.split(/[\n;]+/).forEach(function (ln) {
      var p = ln.split(/[,\t ]+/).filter(function (x) { return x !== ''; });
      if (p.length >= 2) {
        var mic = parseFloat(p[0]), f = parseFloat(p[1]);
        if (isFinite(mic) && isFinite(f)) out.push({ mic: mic, freq: f });
      }
    });
    return out.length ? out : null;
  }

  function drawCfr(results) {
    var host = $('cfrOut'); if (!host) return;
    var dist = parseMicDist();
    if (!dist) { host.innerHTML = ''; return; }
    var onLadder = dist.filter(function (d) {
      return M.LADDER.some(function (v) { return Math.abs(v - d.mic) < 1e-9; });
    });
    var html = results.map(function (r) {
      var v = P.cfr(r.pta, dist);
      return '<div class="kv"><span>' + r.label + '</span><span>' + fmt(v) + '%</span></div>';
    }).join('');
    host.innerHTML = '<div style="margin-top:8px"><b style="font-size:.75rem">CFR</b>' + html +
      (onLadder.length < dist.length
        ? '<div class="note">' + (dist.length - onLadder.length) + ' MIC value(s) are not on the ' +
          'simulated ladder (' + M.LADDER.join(', ') + ' mg/L) and were ignored.</div>'
        : '') + '</div>';
  }

  function drawRenal() {
    var host = $('renalOut'); if (!host) return;
    var m = model(), r = renalOf(m),
        lab = RENAL_LABEL[r.kind] || 'Renal function',
        rows = r.crcl != null
          ? '<div class="kv"><span>' + lab + '</span><span>' +
            fmt(r.crcl) + ' mL/min</span></div>'
          : '<div class="kv"><span>' + lab + '</span><span>' +
            fmt(r.egfr) + (r.kind === 'mdrd' ? ' mL/min' : ' mL/min/1.73m²') +
            '</span></div>';
    // The clearance a model actually uses is worth showing next to the
    // renal estimate, because several of these models are step functions
    // of dialysis modality rather than smooth functions of GFR.
    var pr = modelResolved().params(covFull());
    rows += '<div class="kv"><span>Typical CL</span><span>' +
            fmt(pr.CL) + ' L/h</span></div>';
    if (m.renalDisplayOnly) {
      rows += '<div class="cite" style="margin-top:5px">The clearance above is ' +
              'not driven by this creatinine clearance: the model scales ' +
              'renal function through a serum-creatinine ratio and size ' +
              'through fat-free mass. The estimate is shown for orientation ' +
              'only.</div>';
    }
    if (m.id === 'tob_hennig2013') {
      rows += '<div class="kv"><span>Fat-free mass</span><span>' +
              fmt(P.ffmJanmahasatian({ wt: S.cov.wt, ht: S.cov.ht, sex: S.cov.sex })) +
              ' kg</span></div>';
    }
    host.innerHTML = rows;
  }

  /* ---------------- Bayesian forecasting ---------------- */
  var LASTMAP = null;
  var LAST_ACTIVE = {};
  var tdmSamples = [{ time: '', conc: '' }];

  function renderTdm() {
    var tb = $('tdmRows'); if (!tb) return;
    tb.innerHTML = tdmSamples.map(function (s, i) {
      return '<tr>' +
        '<td><input type="number" step="0.1" data-t="' + i + '" value="' + s.time + '" style="width:100%"></td>' +
        '<td><input type="number" step="0.1" data-c="' + i + '" value="' + s.conc + '" style="width:100%"></td>' +
        '<td><button class="mini" data-x="' + i + '">×</button></td></tr>';
    }).join('');
    tb.querySelectorAll('input[data-t]').forEach(function (el) {
      el.oninput = function () { tdmSamples[+el.getAttribute('data-t')].time = el.value; };
    });
    tb.querySelectorAll('input[data-c]').forEach(function (el) {
      el.oninput = function () { tdmSamples[+el.getAttribute('data-c')].conc = el.value; };
    });
    tb.querySelectorAll('button[data-x]').forEach(function (el) {
      el.onclick = function () {
        tdmSamples.splice(+el.getAttribute('data-x'), 1);
        if (!tdmSamples.length) tdmSamples.push({ time: '', conc: '' });
        renderTdm();
      };
    });
  }

  function runMap() {
    var m = modelResolved(), cov = covFull(), out = $('mapOut');
    if (m.bayesian === false) { out.innerHTML = '<div class="note">' + m.bayesianNote + '</div>'; return; }
    var samples = tdmSamples.map(function (s) {
      return { time: parseFloat(s.time), conc: parseFloat(s.conc) };
    }).filter(function (s) { return isFinite(s.time) && isFinite(s.conc); });
    if (samples.length < 1) {
      out.innerHTML = '<div class="note">Enter at least one time–concentration pair.</div>';
      return;
    }
    var reg = { dose: num($('tdmDose').value, 1000), tau: num($('tdmTau').value, 12),
                tinf: num($('tdmTinf').value, 1), nDoses: Math.max(1, num($('tdmN').value, 4)) };
    var sched = P.buildSchedule(reg);
    var fit = P.mapEstimate(m, cov, sched.events, samples);

    // Individual profile for the overlay and for exposure metrics.
    var tEnd = sched.tEnd + reg.tau, ts = [], cs = [], i;
    for (i = 0; i <= 300; i++) { var tt = (i * tEnd) / 300; ts.push(tt); cs.push(fit.predict(tt)); }
    /* The fit is stored with the dosing record it was estimated from and
       the observations themselves. Both are needed to draw the sampled
       period; and keeping the record means the sample points can never be
       drawn against a dosing history they do not belong to, which would
       misplace them silently. drawConc() still regenerates the forecast
       overlay on whatever window the plot is showing, so that cannot fall
       out of step with the displayed regimen either. */
    LASTMAP = { fit: fit, regimen: reg, samples: samples };

    var t = target(),
        cfInd = fit.predict,
        mInd = P.metrics(cfInd, sched.tEnd - reg.tau, sched.tEnd,
                         { fu: m.fu, mic: S.mic * (t.micMultiplier || 1), nGrid: 800 });
    var hit = P.meetsTarget(mInd, t, S.mic);

    // Smallest dose (same tau/tinf, 250 mg steps) meeting the target for
    // this individual — the dose-adjustment question TDM is asked for.
    var rec = null;
    for (var d = 250; d <= 12000; d += 250) {
      var rr = { dose: d, tau: reg.tau, tinf: reg.tinf,
                 nDoses: P.dosesToSteadyState(fit.params, m.ncmt, reg.tau) };
      var sc = P.buildSchedule(rr), cf2 = P.concFn(fit.params, m.ncmt, sc);
      var mm = P.metrics(cf2, sc.tEnd - reg.tau, sc.tEnd,
                         { fu: m.fu, mic: S.mic * (t.micMultiplier || 1), nGrid: 400 });
      if (P.meetsTarget(mm, t, S.mic)) { rec = { dose: d, metrics: mm }; break; }
    }

    var keys = fit.keys;
    out.innerHTML =
      '<div class="grid2">' +
      '<div><table><thead><tr><th>Parameter</th><th class="num">Population</th>' +
        '<th class="num">Individual (MAP)</th><th class="num">η</th></tr></thead><tbody>' +
        keys.map(function (k, i2) {
          return '<tr><td>' + k + '</td><td class="num">' + fmt(fit.typicalParams[k], 2) +
            '</td><td class="num"><b>' + fmt(fit.params[k], 2) + '</b></td>' +
            '<td class="num">' + fmt(fit.etas[i2], 2) + '</td></tr>';
        }).join('') +
        '</tbody></table>' +
        '<table style="margin-top:8px"><thead><tr><th>Sample</th><th class="num">Observed</th>' +
        '<th class="num">MAP predicted</th></tr></thead><tbody>' +
        fit.fitted.map(function (f, i3) {
          return '<tr><td>t = ' + fmt(f.time, 1) + ' h</td><td class="num">' + fmt(f.obs, 2) +
            '</td><td class="num">' + fmt(f.pred, 2) + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
      '<div>' +
        /* The population figure for the SAME dosing record, so the
           individual number has something to be read against. Without it
           a student sees "individual AUC 512" and has nothing to compare
           it to; the interesting quantity is the shift. */
        (function () {
          var popFit = P.simulate({
                model: m, cov: cov,
                regimen: { dose: reg.dose, tau: reg.tau, tinf: reg.tinf,
                           nDoses: reg.nDoses },
                target: t, mics: [S.mic], mic: S.mic,
                n: Math.min(S.n, 1500), seed: S.seed, nGrid: 300
              }),
              indVal = t.type === 'auc' || t.type === 'aucmic' ? mInd.auc24
                     : t.type === 'cmin' || t.type === 'cminceil' ? mInd.cmin
                     : t.type === 'cmaxmic' ? mInd.cmax : mInd.tAbove,
              popVal = t.type === 'auc' || t.type === 'aucmic' ? popFit.exposure.auc24.median
                     : t.type === 'cmin' || t.type === 'cminceil' ? popFit.exposure.cmin.median
                     : t.type === 'cmaxmic' ? popFit.exposure.cmax.median
                     : popFit.exposure.tAbove.median,
              unit = t.type === 'auc' || t.type === 'aucmic' ? ' mg\u00b7h/L'
                   : t.type === 'ftmic' ? '%' : ' mg/L';
          return '<table><thead><tr><th>On the sampled record</th>' +
            '<th class="num">Population</th><th class="num">This individual</th>' +
            '</tr></thead><tbody>' +
            '<tr><td>' + t.label + '</td><td class="num">' + fmt(popVal, 1) + unit +
              '</td><td class="num"><b>' + fmt(indVal, 1) + unit + '</b></td></tr>' +
            '<tr><td>AUC\u2080\u208b\u2082\u2084</td><td class="num">' +
              fmt(popFit.exposure.auc24.median, 0) + '</td><td class="num"><b>' +
              fmt(mInd.auc24, 0) + '</b></td></tr>' +
            '<tr><td>C\u2098\u1d62\u2099</td><td class="num">' +
              fmt(popFit.exposure.cmin.median, 2) + '</td><td class="num"><b>' +
              fmt(mInd.cmin, 2) + '</b></td></tr>' +
            '<tr><td>C\u2098\u2090\u2093</td><td class="num">' +
              fmt(popFit.exposure.cmax.median, 1) + '</td><td class="num"><b>' +
              fmt(mInd.cmax, 1) + '</b></td></tr>' +
            '<tr><td>Attainment across the population</td><td class="num">' +
              fmt(popFit.ptaAtRefMic) + '%</td><td class="num">' +
              '<span class="pill ' + (hit ? 'ok' : 'bad') + '">' +
              (hit ? 'met' : 'missed') + '</span></td></tr>' +
            '</tbody></table>' +
            '<p class="cite">The population column is this patient\u2019s ' +
            'covariates run through the model without the samples \u2014 the ' +
            'prediction you would have made before measuring. The ' +
            'attainment percentage is a probability over the simulated ' +
            'population; for one identified individual the target is simply ' +
            'met or not.</p>';
        })() +
        '<div class="kv"><span>Individual ' + t.label + '</span><span>' +
          (t.type === 'auc' ? fmt(mInd.auc24, 0) + ' mg·h/L'
            : t.type === 'cmin' ? fmt(mInd.cmin, 2) + ' mg/L'
            : fmt(mInd.tAbove) + '%') +
          ' <span class="pill ' + (hit ? 'ok' : 'bad') + '">' +
          (hit ? 'target met' : 'target missed') + '</span></span></div>' +
        '<div class="kv"><span>Individual AUC₀₋₂₄</span><span>' + fmt(mInd.auc24, 0) + ' mg·h/L</span></div>' +
        '<div class="kv"><span>Individual Cmin</span><span>' + fmt(mInd.cmin, 2) + ' mg/L</span></div>' +
        '<div class="kv"><span>Individual Cmax</span><span>' + fmt(mInd.cmax, 1) + ' mg/L</span></div>' +
        '<div style="margin-top:10px">' +
          (rec
            ? '<b style="font-size:.8rem">Smallest dose meeting ' + t.label + '</b>' +
              '<div class="big" style="font-size:1.4rem">' + rec.dose + ' mg q' + reg.tau + 'h' +
              '<small> (' + reg.tinf + ' h infusion, this individual)</small></div>'
            : '<div class="note">No dose up to 12 g per interval met the target for this ' +
              'individual at the current interval and infusion duration.</div>') +
        '</div>' +
        /* A parameter pushed far beyond its own between-subject SD means
           the samples and the prior disagree, not that individualisation
           succeeded. Students otherwise read any fitted curve as "the
           patient", including one the model can barely represent. The
           threshold is on eta/omega, so a parameter with a wide published
           omega (V2 here, at 130%) is not flagged for a large absolute
           eta while a tight one (V1, 15%) is. */
        (function () {
          var strained = keys.map(function (k, i4) {
            var om = P.omegaOf(m, k);
            return { k: k, z: om > 0 ? fit.etas[i4] / om : 0 };
          }).filter(function (x) { return Math.abs(x.z) > 3; });
          if (!strained.length) return '';
          return '<div class="note" style="margin-top:10px">' +
            '<b>The samples and the population prior disagree.</b> ' +
            strained.map(function (x) {
              return x.k + ' is ' + fmt(Math.abs(x.z), 1) + ' between-subject SD ' +
                     (x.z < 0 ? 'below' : 'above') + ' its typical value';
            }).join('; ') +
            '. The MAP estimate is still the best compromise between these ' +
            'measurements and the model, but a deviation this large usually ' +
            'means something other than an unusual patient \u2014 a mistimed ' +
            'or mislabelled sample, a dosing record that does not match what ' +
            'was actually given, or a model built in a population this ' +
            'patient does not belong to. Check those before acting on the ' +
            'individualised curve.</div>';
        })() +
        '<p class="cite">MAP estimate maximises the posterior combining these samples with ' +
        'the model prior (ω) and residual error (additive ' + (m.err.add || 0) + ' mg/L, ' +
        'proportional ' + Math.round((m.err.prop || 0) * 100) + '%). Sparse samples shrink ' +
        'toward the population value — that is the intended behaviour, not a fitting failure.</p>' +
      '</div></div>';
    drawConc(LAST.results, t);
  }

  /* ---------------- embed URL builder ---------------- */
  function buildEmbed() {
    var r = S.regimens[0], p = ['mode=widget', 'model=' + S.modelId,
      'target=' + target().id, 'mic=' + S.mic, 'n=' + S.n, 'seed=' + S.seed,
      'pta=' + S.ptaThresh];
    if (r.mode === 'ci') { p.push('ci=1'); p.push('dose24=' + r.dose24); }
    else { p.push('dose=' + r.dose, 'tau=' + r.tau, 'tinf=' + r.tinf); }
    if (S.regimens[1]) {
      var b = S.regimens[1];
      if (!b.mode) p.push('dose2=' + b.dose, 'tau2=' + b.tau, 'tinf2=' + b.tinf);
    }
    if (S.regimens[2]) {
      var c = S.regimens[2];
      if (!c.mode) p.push('dose3=' + c.dose, 'tau3=' + c.tau, 'tinf3=' + c.tinf);
    }
    ['wt', 'age', 'sex', 'scr', 'scrUnit', 'cysc', 'ht', 'rd', 'alb'].forEach(function (k) {
      if (S.cov[k] != null && S.cov[k] !== '') p.push(k + '=' + encodeURIComponent(S.cov[k]));
    });
    if (S.nDoses) p.push('ndoses=' + S.nDoses);
    if (S.evalDose) p.push('evaldose=' + S.evalDose);
    if (S.plotWhole) p.push('whole=1');
    if (!S.bayes) p.push('bayes=0');
    if (!S.fitView) p.push('fitview=0');
    if (S.cov.ecmo) p.push('ecmo=1');
    if (S.cov.rrt) p.push('rrt=1');
    if (S.cov.trauma) p.push('trauma=1');
    if (S.cov.sepsis) p.push('sepsis=1');
    if (S.cov.dialysis && S.cov.dialysis !== 'none') p.push('dialysis=' + S.cov.dialysis);
    if (S.logy) p.push('logy=1');
    var file = window.location.pathname.split('/').pop() || 'mipd-lab.html';
    var url = file + '?' + p.join('&');
    var ta = $('embedOut');
    ta.style.display = 'block';
    ta.value = '<iframe src="' + url + '" width="100%" height="560" ' +
               'style="border:0" loading="lazy"></iframe>';
    ta.select();
  }

  /* ---------------- init ---------------- */
  function bindCov() {
    var map = [['wt', 'wt', 'num'], ['age', 'age', 'num'], ['ht', 'ht', 'num'],
               ['scr', 'scr', 'num'], ['cysc', 'cysc', 'num'], ['rd', 'rd', 'num'],
               ['alb', 'alb', 'num'],
               ['sex', 'sex', 'str'], ['scrUnit', 'scrUnit', 'str'],
               ['dialysis', 'dialysis', 'str']];
    map.forEach(function (m2) {
      var el = $(m2[0]); if (!el) return;
      el.value = S.cov[m2[1]];
      el.addEventListener('input', function () {
        S.cov[m2[1]] = m2[2] === 'num' ? parseFloat(el.value) : el.value;
        syncWidgetRenal(); run();
      });
      el.addEventListener('change', function () {
        S.cov[m2[1]] = m2[2] === 'num' ? parseFloat(el.value) : el.value;
        syncWidgetRenal(); run();
      });
    });
    var ec = $('ecmo');
    if (ec) {
      ec.checked = !!S.cov.ecmo;
      ec.onchange = function () { S.cov.ecmo = ec.checked; syncModel(false); run(); };
    }
    [['trauma', 'trauma'], ['sepsis', 'sepsis']].forEach(function (p) {
      var el = $(p[0]); if (!el) return;
      el.checked = !!S.cov[p[1]];
      el.onchange = function () { S.cov[p[1]] = el.checked; syncModel(false); run(); };
    });
    var rr = $('rrt');
    if (rr) {
      rr.checked = !!S.cov.rrt;
      rr.onchange = function () { S.cov.rrt = rr.checked; syncModel(false); run(); };
    }
  }
  function syncWidgetRenal() {
    var wr = $('wRenal'); if (!wr) return;
    var r = renalOf(model());
    wr.value = Math.round(r.crcl != null ? r.crcl : r.egfr);
  }

  /* In widget mode the renal input is the covariate itself: back-solve
     serum creatinine (or cystatin C) so the model sees the value shown. */
  function setRenalDirect(v) {
    var m = model(), c = S.cov, lo, hi, i, mid;
    if (m.renal === 'cysc') {
      // Invert CKD-EPI cystatin C for cystatin C.
      lo = 0.2; hi = 8;
      for (i = 0; i < 60; i++) {
        mid = (lo + hi) / 2;
        if (P.ckdEpiCysC({ cysc: mid, age: c.age, sex: c.sex }) > v) lo = mid;
        else hi = mid;
      }
      c.cysc = (lo + hi) / 2;
      return;
    }
    if (m.renal === 'ckdepi' || m.renal === 'mdrd') {
      // Both are decreasing in creatinine, so bisect on SCr in mg/dL.
      var f = (m.renal === 'ckdepi')
        ? function (s) { return P.ckdEpiCr({ scr: s, scrUnit: 'mg/dL', age: c.age, sex: c.sex }); }
        : function (s) { return P.mdrd({ scr: s, scrUnit: 'mg/dL', age: c.age, sex: c.sex }); };
      lo = 0.1; hi = 25;
      for (i = 0; i < 80; i++) {
        mid = (lo + hi) / 2;
        if (f(mid) > v) lo = mid; else hi = mid;
      }
      c.scrUnit = 'mg/dL'; c.scr = (lo + hi) / 2;
      return;
    }
    // Cockcroft-Gault inverts in closed form.
    var g = c.sex === 'F' ? 0.85 : 1;
    c.scrUnit = 'mg/dL';
    c.scr = ((140 - c.age) * c.wt * g) / (72 * v);
  }

  function bindWidget() {
    var pairs = [['wDose', function (v) {
        var r = S.regimens[0];
        if (r.mode === 'ci') r.dose24 = v; else r.dose = v;
      }],
      ['wTau', function (v) { S.regimens[0].tau = v; }],
      ['wTinf', function (v) { S.regimens[0].tinf = v; }],
      ['wMic', function (v) { S.mic = v; }],
      ['wRenal', function (v) { setRenalDirect(v); }]];
    pairs.forEach(function (p) {
      var el = $(p[0]); if (!el) return;
      el.addEventListener('input', function () {
        var v = parseFloat(el.value);
        if (isFinite(v)) { p[1](v); run(); }
      });
    });
    var r = S.regimens[0];
    if ($('wDose')) $('wDose').value = r.mode === 'ci' ? r.dose24 : r.dose;
    if ($('wTau')) $('wTau').value = r.tau || '';
    if ($('wTinf')) $('wTinf').value = r.tinf || '';
    if (r.mode === 'ci') {
      ['wTau', 'wTinf'].forEach(function (id) {
        var e = $(id); if (e) e.parentNode.style.display = 'none';
      });
    }
  }

  function renderPending() {
    var host = $('pendingList'); if (!host) return;
    if (!M.PENDING.length) {
      host.innerHTML = 'None \u2014 every model in the library is implemented ' +
        'from its own published parameter table. A model that cannot be ' +
        'faithfully reproduced is listed here rather than approximated.';
      return;
    }
    host.innerHTML = M.PENDING.map(function (p) {
      return '<div style="margin-bottom:7px"><b>' + p.drug + ' — ' + p.label + '</b><br>' +
        p.reason + ' <a href="https://doi.org/' + p.doi + '" target="_blank" rel="noopener">doi</a></div>';
    }).join('');
  }

  function init() {
    if (WIDGET) document.body.classList.add('widget');

    /* ?preset=<id> loads a named teaching scenario from the library:
       model, target, the regimens being compared, the covariates and the
       MIC, in one parameter. Explicit URL parameters still win, so a
       preset can be used as a starting point and then adjusted — which is
       what makes it usable as a slide URL. */
    var PRE = null;
    if (Q.preset) {
      (M.PRESETS || []).forEach(function (p) { if (p.id === Q.preset) PRE = p; });
    }
    if (PRE) {
      if (!Q.model) S.modelId = PRE.model;
      if (!Q.target && PRE.target) S.targetId = PRE.target;
    }

    var m0 = null;
    M.MODELS.forEach(function (x) { if (x.id === S.modelId) m0 = x; });
    if (!m0) { S.modelId = M.MODELS[0].id; m0 = M.MODELS[0]; }
    // A preset's covariates and MIC become the defaults for the reads below.
    var PC = (PRE && PRE.cov) || {};

    S.cov = {
      wt: num(Q.wt, PC.wt != null ? PC.wt : 80),
      age: num(Q.age, PC.age != null ? PC.age : 60),
      ht: num(Q.ht, PC.ht != null ? PC.ht : 172),
      sex: (Q.sex || PC.sex) === 'F' ? 'F' : 'M',
      scr: num(Q.scr, PC.scr != null ? PC.scr : 1.0),
      scrUnit: (Q.scrUnit || PC.scrUnit) === 'umol/L' ? 'umol/L' : 'mg/dL',
      cysc: num(Q.cysc, PC.cysc != null ? PC.cysc : 1.0),
      ecmo: bool(Q.ecmo, !!PC.ecmo),
      trauma: bool(Q.trauma, !!PC.trauma),
      sepsis: bool(Q.sepsis, !!PC.sepsis),
      rrt: bool(Q.rrt, false),
      dialysis: (['none', 'cont', 'semicont'].indexOf(Q.dialysis) >= 0
                 ? Q.dialysis : 'none'),
      // 845 mL/24 h is the population median residual diuresis in the
      // O'Jeanson cohort, which is the value its typical clearance is
      // centred on, so it is the neutral default.
      rd: num(Q.rd, 845),
      alb: num(Q.alb, PC.alb != null ? PC.alb : 2.8)
    };
    S.mic = num(Q.mic, PRE && PRE.mic != null ? PRE.mic : m0.defaultMic);
    S.regimens = defaultRegimens();
    if (PRE && PRE.regimens && PRE.regimens.length && !Q.dose) {
      S.regimens = PRE.regimens.slice(0, 3).map(function (r, i) {
        var o = { label: r.label || 'ABC'.charAt(i), on: true };
        if (r.mode === 'ci') { o.mode = 'ci'; o.dose24 = r.dose24; }
        else { o.dose = r.dose; o.tau = r.tau; o.tinf = r.tinf; }
        return o;
      });
    }
    if (Q.crcl) setRenalDirect(num(Q.crcl, 80));
    if (Q.egfr) setRenalDirect(num(Q.egfr, 80));

    syncModel(false);
    bindCov();
    bindWidget();
    renderPending();
    renderTdm();

    [['mic', function (v) { S.mic = v; var w = $('wMic'); if (w) w.value = v; }],
     ['ptaThresh', function (v) { S.ptaThresh = v; }],
     ['nsim', function (v) { S.n = Math.max(50, Math.min(20000, v)); }],
     ['seed', function (v) { S.seed = v; }]].forEach(function (p) {
      var el = $(p[0]); if (!el) return;
      el.addEventListener('input', function () {
        var v = parseFloat(el.value);
        if (isFinite(v)) { p[1](v); run(); }
      });
    });
    if ($('mic')) $('mic').value = S.mic;

    // Dosing-course controls. A blank field means "auto": doses given ->
    // out to steady state, evaluate dose -> the last one.
    [['nDosesIn', 'nDoses'], ['evalDoseIn', 'evalDose']].forEach(function (p) {
      var el = $(p[0]); if (!el) return;
      if (S[p[1]] != null) el.value = S[p[1]];
      el.addEventListener('input', function () {
        var v = parseFloat(el.value);
        S[p[1]] = (el.value === '' || !isFinite(v) || v < 1) ? null : Math.round(v);
        run();
      });
    });
    var pw = $('plotWhole');
    if (pw) {
      pw.checked = S.plotWhole;
      pw.onchange = function () {
        S.plotWhole = pw.checked;
        var w = $('wWhole'); if (w) w.value = pw.checked ? '1' : '0';
        run();
      };
    }
    var ww = $('wWhole');
    if (ww) {
      ww.value = S.plotWhole ? '1' : '0';
      ww.onchange = function () {
        S.plotWhole = ww.value === '1';
        if (pw) pw.checked = S.plotWhole;
        run();
      };
    }

    var fv = $('fitView');
    if (fv) {
      fv.checked = S.fitView;
      fv.onchange = function () { S.fitView = fv.checked; run(); };
    }
    var bOn2 = $('bayesOn');
    if (bOn2) {
      bOn2.checked = S.bayes;
      bOn2.onchange = function () {
        S.bayes = bOn2.checked;
        syncModel(false);
        run();
      };
    }
    var ly = $('logy');
    if (ly) { ly.checked = S.logy; ly.onchange = function () { S.logy = ly.checked; run(); }; }
    var md = $('micDist');
    if (md) md.addEventListener('input', function () { drawCfr(LAST.results); });
    if ($('addReg')) $('addReg').onclick = function () {
      if (S.regimens.length >= 3) return;
      var d = model().defaultRegimen;
      if (d.mode === 'ci') d = { dose: Math.round((d.dose24 || 12000) / 3), tau: 8, tinf: 0.5 };
      S.regimens.push({ label: 'ABC'.charAt(S.regimens.length),
                        dose: d.dose, tau: d.tau, tinf: d.tinf, on: true });
      renderRegimens(); run();
    };
    if ($('addTdm')) $('addTdm').onclick = function () {
      tdmSamples.push({ time: '', conc: '' }); renderTdm();
    };
    if ($('runMap')) $('runMap').onclick = runMap;
    if ($('mkEmbed')) $('mkEmbed').onclick = buildEmbed;
    // The TDM dosing record is always intermittent (a bolus history is
    // what MAP estimation is fitted to), so a model whose default is a
    // continuous infusion needs a plain intermittent starting point.
    var dr = model().defaultRegimen,
        drI = dr.mode === 'ci'
          ? { dose: Math.round((dr.dose24 || 12000) / 3), tau: 8, tinf: 0.5 }
          : dr;
    if ($('tdmDose')) $('tdmDose').value = drI.dose;
    if ($('tdmTau')) $('tdmTau').value = drI.tau;
    if ($('tdmTinf')) $('tdmTinf').value = drI.tinf;

    // Title and subtitle are written by drawHeader() on every run, so
    // they cannot go stale when the model changes.
    $('footer').innerHTML = 'Simulation for teaching and exploratory PK/PD analysis. ' +
      'Not a medical device and not a substitute for clinical judgement or local ' +
      'dosing policy; individual dosing decisions require a qualified clinician with ' +
      'the full patient context.';

    if (WIDGET) {
      var panel = Q.panel || 'both';
      if (panel === 'pta' || panel === 'conc') {
        var keep = panel === 'pta' ? 0 : 1,
            kids = $('panelPta').querySelectorAll('.grid2 > div');
        kids[1 - keep].style.display = 'none';
        $('panelPta').querySelector('.grid2').style.gridTemplateColumns = '1fr';
      }
      if (bool(Q.summary, true) === false) $('panelSummary').classList.add('hidden');
      if (bool(Q.controls, true) === false) $('wstripCard').classList.add('hidden');
    }

    run();
    window.addEventListener('resize', function () { if (LAST) run(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else init();
})();
