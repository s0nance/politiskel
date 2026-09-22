"use strict";
/* Reads a PolitiScales result out of a screenshot.

   Shared file: loaded as-is by the browser (<script src>) and by Node
   (require). It only needs an image object {width, height, data} in RGBA —
   which is what canvas.getImageData and tools/lib/png.js both hand back.

   Principle: percentages are read from bar GEOMETRY, not by OCR — a 5%
   segment carries no label at all and would be unreadable otherwise. A
   segment's width is exactly proportional to its percentage.

   Careful: the three segments summing to 100% proves NOTHING. The neutral
   share is derived (track − left − right), so that sum is true by
   construction. One screenshot came out wrong on two axes with perfect sums.
   The real check compares the derived neutral against the gap actually
   measured between the two segments — see below. */
(function (global) {

  /* The 8 axes, in the order PolitiScales lays them out. `color` is only
     used to resolve the ambiguous 100% case: a single full-width bar gives no
     positional clue about which side it belongs to. */
  const AXES = [
    { neg: "ess",  pos: "cst",   labels: ["Constructivisme", "Essentialisme"],
      color: [[155, 49, 177], [52, 182, 52]] },
    { neg: "pun",  pos: "rehab", labels: ["Justice réhabilitative", "Justice punitive"],
      color: [[76, 190, 225], [230, 204, 39]] },
    { neg: "csv",  pos: "prg",   labels: ["Progressisme", "Conservatisme"],
      color: [[133, 1, 131], [151, 0, 0]] },
    { neg: "nat",  pos: "int",   labels: ["Internationalisme", "Nationalisme"],
      color: [[63, 111, 253], [255, 134, 2]] },
    { neg: "com",  pos: "cap",   labels: ["Communisme", "Capitalisme"],
      color: [[204, 39, 25], [255, 185, 4]] },
    { neg: "reg",  pos: "laf",   labels: ["Régulation", "Laissez-faire"],
      color: [[38, 155, 50], [102, 8, 192]] },
    { neg: "eco",  pos: "prod",  labels: ["Écologie", "Productivisme"],
      color: [[160, 233, 13], [77, 234, 233]] },
    { neg: "ref",  pos: "rev",   labels: ["Révolution", "Réformisme"],
      color: [[221, 55, 103], [17, 228, 201]] }
  ];
  /* left key / right key, as they appear in the image */
  const SIDE = [["cst", "ess"], ["rehab", "pun"], ["prg", "csv"], ["int", "nat"],
                ["com", "cap"], ["reg", "laf"], ["eco", "prod"], ["rev", "ref"]];

  const SAT_DELTA = 45, SAT_MIN = 60;

  function reader(img) {
    const { width: W, data: D } = img;
    return (x, y) => { const i = (y * W + x) * 4; return [D[i], D[i + 1], D[i + 2]]; };
  }
  const saturated = p => {
    const mx = Math.max(p[0], p[1], p[2]), mn = Math.min(p[0], p[1], p[2]);
    return mx - mn > SAT_DELTA && mx > SAT_MIN;
  };
  const dist2 = (a, b) =>
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

  /* Runs of rows where more than `frac` of the width is saturated. */
  function horizontalBands(img, at, frac, minH) {
    const { width: W, height: H } = img;
    const bands = []; let start = -1;
    for (let y = 0; y < H; y++) {
      let n = 0;
      for (let x = 0; x < W; x++) if (saturated(at(x, y))) n++;
      const on = n > W * frac;
      if (on && start < 0) start = y;
      else if (!on && start >= 0) { if (y - start >= minH) bands.push([start, y - 1]); start = -1; }
    }
    if (start >= 0 && H - start >= minH) bands.push([start, H - 1]);
    return bands;
  }

  /* For one band, the x ranges belonging to a coloured segment. A column
     counts as soon as a handful of its rows are saturated, measured over the
     bar's WHOLE height: the white percentage glyphs never span the bar top to
     bottom, so coloured pixels always remain above and below each one.
     Requiring a majority of rows instead chops the segment at every digit.
     The neutral segment and the 2px separators are saturated on no row. */
  function runsOf(img, at, band) {
    const { width: W } = img;
    const y0 = band[0] + 2, y1 = band[1] - 2;
    const need = Math.max(2, Math.round((y1 - y0 + 1) * 0.08));
    const runs = []; let start = -1;
    for (let x = 0; x < W; x++) {
      let n = 0;
      for (let y = y0; y <= y1; y++) if (saturated(at(x, y))) n++;
      const on = n >= need;
      if (on && start < 0) start = x;
      else if (!on && start >= 0) { if (x - start > 2) runs.push([start, x - 1]); start = -1; }
    }
    if (start >= 0) runs.push([start, W - 1]);
    return { runs, y0, y1 };
  }

  function meanColor(at, run, y0, y1) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let x = run[0] + 2; x <= run[1] - 2; x++)
      for (let y = y0; y <= y1; y++) {
        const p = at(x, y);
        if (saturated(p)) { r += p[0]; g += p[1]; b += p[2]; n++; }
      }
    return n ? [r / n, g / n, b / n] : null;
  }

  /* A column's representative colour: median of the bar's pixels, ignoring
     white text and black outlines. */
  function columnColor(at, x, y0, y1) {
    const R = [], G = [], B = [];
    for (let y = y0; y <= y1; y++) {
      const p = at(x, y);
      const mx = Math.max(p[0], p[1], p[2]), mn = Math.min(p[0], p[1], p[2]);
      if (mn > 245) continue;                       /* pure white text */
      if (mx < 60) continue;                        /* black outline */
      R.push(p[0]); G.push(p[1]); B.push(p[2]);
    }
    if (!R.length) return null;
    const med = a => { a.sort((u, v) => u - v); return a[a.length >> 1]; };
    return [med(R), med(G), med(B)];
  }

  /* Precise segment boundaries: every column of the track is assigned to
     whichever colour it is closest to — left segment, neutral background, or
     right segment. Finding edges by saturation favoured vivid hues (acid
     green held its edge, pale cyan lost it), which shifted both ends by
     several pixels as soon as the screenshot was not at scale 1. */
  function segmentEdges(at, y0, y1, trackL, trackR, first, last, bg) {
    const cL = columnColor(at, (first[0] + first[1]) >> 1, y0, y1);
    const cR = columnColor(at, (last[0] + last[1]) >> 1, y0, y1);
    if (!cL || !cR || !bg) return null;
    const cls = x => {
      const c = columnColor(at, x, y0, y1);
      if (!c) return "n";
      const dl = dist2(c, cL), dn = dist2(c, bg), dr = dist2(c, cR);
      return dl <= dn && dl <= dr ? "l" : (dr <= dn ? "r" : "n");
    };
    /* Start from inside each segment: the track's caps are rounded, hence
       mostly background, so a scan working inwards from the ends would stop
       immediately. */
    let bL = first[1];
    if (cls(bL) === "l") { while (bL + 1 <= trackR && cls(bL + 1) === "l") bL++; }
    else { while (bL > trackL && cls(bL) !== "l") bL--; }
    let bR = last[0];
    if (cls(bR) === "r") { while (bR - 1 >= trackL && cls(bR - 1) === "r") bR--; }
    else { while (bR < trackR && cls(bR) !== "r") bR++; }
    if (bL >= bR) return null;
    return { left: bL - trackL + 1, right: trackR - bR + 1 };
  }

  /* Spreads 100 points across three widths (largest-remainder method) so the
     total is exactly 100, as on the original page. */
  function toPercents(widths) {
    const total = widths.reduce((a, b) => a + b, 0) || 1;
    const exact = widths.map(w => w / total * 100);
    const base = exact.map(Math.floor);
    let rest = 100 - base.reduce((a, b) => a + b, 0);
    exact.map((v, i) => [v - base[i], i]).sort((a, b) => b[0] - a[0])
      .forEach(([, i]) => { if (rest > 0) { base[i]++; rest--; } });
    return base;
  }

  function extract(img) {
    const warnings = [];
    const at = reader(img);
    const { width: W, height: H } = img;

    const bands = horizontalBands(img, at, 0.30, Math.max(6, Math.round(H * 0.005)));
    if (bands.length < 9) return { ok: false, warnings: ["unrecognised layout: " + bands.length + " coloured bands found, at least 9 expected"] };

    const bars = bands.slice(-8);
    const pitches = bars.slice(1).map((b, i) => b[0] - bars[i][0]);
    const pitchSpread = Math.max(...pitches) - Math.min(...pitches);
    if (pitchSpread > Math.max(4, H * 0.01))
      warnings.push("uneven bar spacing (" + pitchSpread + "px): the screenshot may be cropped");

    const perBar = bars.map(b => runsOf(img, at, b));
    if (perBar.some(b => !b.runs.length)) return { ok: false, warnings: ["at least one bar is empty"] };

    const trackL = Math.min(...perBar.map(b => b.runs[0][0]));
    const trackR = Math.max(...perBar.map(b => b.runs[b.runs.length - 1][1]));
    const trackW = trackR - trackL + 1;
    const tol = Math.max(3, Math.round(trackW * 0.012));

    /* Card background colour, sampled in the gap between two bars, mid-track.
       Sampling to the left of the track landed on the axis medallion (metallic
       grey, as dark as #676262 on a narrow screenshot): the "background"
       reference was then so wrong that neutral columns got classified as a
       coloured segment. */
    const bgY = (bars[0][1] + bars[1][0]) >> 1;
    const bgColor = at((trackL + trackR) >> 1, bgY);

    const values = {}, neutrals = [], raw = [];
    perBar.forEach((bar, i) => {
      const { runs, y0, y1 } = bar;
      const first = runs[0], last = runs[runs.length - 1];
      const atL = first[0] <= trackL + tol, atR = last[1] >= trackR - tol;
      let lw, rw;

      if (runs.length >= 2 && atL && atR) {
        const e = segmentEdges(at, y0, y1, trackL, trackR, first, last, bgColor);
        /* The two 2px separators are taken from the neutral share and from the
           left edge of the right segment; the left segment keeps its full
           width. Measured across the reference screenshots: zero bias on the
           left, −2px × scale on the right. So only the right is given back.
           (Checked over 96 values: the setting holds across the whole plateau
           A in [−0.5, 0] and B in [1, 2.5], so it is not a fragile fit.) */
        const s = trackW / 590;
        if (e) { lw = e.left; rw = e.right + 2 * s; }
        else   { lw = (first[1] + 1) - trackL + 1; rw = trackR - (last[0] - 1) + 1; }
      } else if (runs.length === 1 && atL && atR) {
        /* a single full bar: 100% on one side, colour decides which */
        const c = meanColor(at, first, y0, y1);
        const toLeft = c ? dist2(c, AXES[i].color[0]) <= dist2(c, AXES[i].color[1]) : true;
        lw = toLeft ? trackW : 0;
        rw = toLeft ? 0 : trackW;
      } else if (atL) {
        lw = first[1] - first[0] + 1; rw = 0;
      } else if (atR) {
        lw = 0; rw = last[1] - last[0] + 1;
      } else {
        warnings.push("axis \"" + AXES[i].labels[0] + "\": segments not aligned with the track");
        lw = first[1] - first[0] + 1; rw = last[1] - last[0] + 1;
      }

      lw = Math.min(lw, trackW); rw = Math.min(rw, trackW - lw);
      const nw = Math.max(0, trackW - lw - rw);

      /* Independent check: the derived neutral (track − left − right) must
         land on the gap actually measured between the two segments, give or
         take the separators. The 100% sum proves nothing, since the neutral is
         derived from it — that sum is true by construction. */
      if (runs.length >= 2) {
        const measuredGap = last[0] - first[1] - 1;
        if (Math.abs(measuredGap - nw) > Math.max(6, trackW * 0.02))
          warnings.push("axis \"" + AXES[i].labels[0] + "\": derived neutral "
            + Math.round(nw) + "px against " + measuredGap + "px measured");
      }
      raw.push({ lw, nw, rw, trackW });
      const [lp, np, rp] = toPercents([lw, nw, rw]);
      values[SIDE[i][0]] = lp;
      values[SIDE[i][1]] = rp;
      neutrals.push(np);
    });

    /* flag area: the tallest coloured band below the header strip */
    let flag = null;
    const cand = bands.slice(0, bands.length - 8).slice(1);
    if (cand.length) {
      const tallest = cand.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
      let x0 = W, x1 = 0;
      for (let y = tallest[0]; y <= tallest[1]; y++)
        for (let x = 0; x < W; x++)
          if (saturated(at(x, y))) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
      if (x1 > x0) flag = { x: x0, y: tallest[0], w: x1 - x0 + 1, h: tallest[1] - tallest[0] + 1 };
    }
    if (!flag) warnings.push("flag not found");

    /* motto area: the first block of dark text below the flag */
    let slogan = null;
    if (flag) {
      const top = flag.y + flag.h + 1, bottom = bars[0][0] - Math.round((bars[0][1] - bars[0][0]) * 0.6);
      const ink = [];
      for (let y = top; y < bottom; y++) {
        let n = 0;
        for (let x = 0; x < W; x++) { const p = at(x, y); if (Math.max(p[0], p[1], p[2]) < 120) n++; }
        ink.push(n > W * 0.015);
      }
      let s = -1, first = null;
      ink.forEach((on, i) => {
        if (on && s < 0) s = i;
        else if (!on && s >= 0) { if (!first && i - s > 3) first = [top + s, top + i - 1]; s = -1; }
      });
      if (!first && s >= 0) first = [top + s, bottom - 1];
      if (first) {
        const pad = Math.round((first[1] - first[0]) * 0.45);
        slogan = { x: 0, y: Math.max(0, first[0] - pad), w: W,
                   h: Math.min(H, first[1] + pad) - Math.max(0, first[0] - pad) + 1 };
      }
    }
    if (!slogan) warnings.push("motto not found");

    return { ok: true, warnings, values, neutrals,
             geometry: { track: { l: trackL, r: trackR }, bars, flag, slogan, raw } };
  }

  /* ---- key concepts: a computed "values" reading of a profile ----
     Independent of OCR, so it is available for hand-typed profiles too. The 8
     axes are ranked by how strongly they lean, and the dominant pole of the
     three strongest is named. */
  /* Returns keys, never display text: which pole dominates and how strongly.
     Turning those into words is the interface's job, so the module stays
     language-neutral. */
  const bandOf = v => v >= 60 ? "strong" : v >= 30 ? "marked" : v >= 12 ? "slight" : "balanced";

  function keyConcepts(values, limit) {
    const leans = SIDE.map(([a, b]) => {
      const va = Number(values[a]), vb = Number(values[b]);
      if (!Number.isFinite(va) && !Number.isFinite(vb)) return null;
      const lean = (va || 0) - (vb || 0);
      return { key: lean >= 0 ? a : b,
               intensity: Math.abs(lean), band: bandOf(Math.abs(lean)) };
    }).filter(Boolean);
    leans.sort((x, y) => y.intensity - x.intensity);
    return leans.filter(l => l.intensity >= 12).slice(0, limit || 3);
  }

  const api = { AXES, SIDE, extract, keyConcepts, toPercents, saturated };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else global.PolitiExtract = api;

})(typeof globalThis !== "undefined" ? globalThis : this);
