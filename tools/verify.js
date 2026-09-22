#!/usr/bin/env node
"use strict";
/* Regression check for the extractor.

     node tools/verify.js

   The reference values were read by eye off each screenshot, once. They were
   not produced by the extractor: if a change to tools/politi-dissect.js shifts
   a reading, this file says so. */

const fs = require("fs");
const path = require("path");
const { decodePNG } = require("./lib/png.js");
const X = require("./politi-dissect.js");

/* Reference values live in politi-results/fixture.json, which is NOT
   committed: this file is code, the fixture is personal data (names, scores,
   mottos). Without it, the structural checks still run. */
const FIXTURE = path.join(__dirname, "..", "politi-results", "fixture.json");
let EXPECTED = {};
try { EXPECTED = JSON.parse(fs.readFileSync(FIXTURE, "utf8")); }
catch (_) { console.log("  (politi-results/fixture.json missing: only the internal checks will run)\n"); }

const SRC = path.join(__dirname, "..", "politi-results");
const DATA = path.join(__dirname, "..", "profiles-data.js");

main();

function main() {
let checked = 0, failed = 0, missing = 0;

/* With no fixture, we at least check that every screenshot parses and that
   the derived neutral lands on the measured gap (the internal check). */
if (!Object.keys(EXPECTED).length) {
  for (const f of fs.readdirSync(SRC).filter(n => /\.png$/i.test(n)).sort()) {
    const res = X.extract(decodePNG(fs.readFileSync(path.join(SRC, f))));
    console.log((res.ok && !res.warnings.length ? "  ok " : "  KO ") + f.padEnd(22)
      + (res.ok ? (res.warnings.join(" ; ") || "extraction consistent") : res.warnings.join(" ; ")));
    if (!res.ok || res.warnings.length) failed++;
  }
  console.log("\n" + (failed ? failed + " screenshot(s) failed" : "every screenshot parses with no warning"));
  process.exitCode = failed ? 1 : 0;
  return;
}

for (const [name, exp] of Object.entries(EXPECTED)) {
  const file = path.join(SRC, name + ".png");
  if (!fs.existsSync(file)) { console.log("  ? " + name + ": screenshot missing"); missing++; continue; }
  const res = X.extract(decodePNG(fs.readFileSync(file)));
  if (!res.ok) { console.log("  ! " + name + " : " + res.warnings.join(" ; ")); failed++; continue; }

  const diffs = [];
  for (const k of Object.keys(exp)) {
    if (k === "slogan") continue;
    checked++;
    if (res.values[k] !== exp[k]) diffs.push(k + " expected " + exp[k] + ", got " + res.values[k]);
  }
  /* the three segments must total 100: a check independent of the reading */
  X.SIDE.forEach(([a, b], i) => {
    const sum = res.values[a] + res.neutrals[i] + res.values[b];
    if (sum !== 100) diffs.push(X.AXES[i].labels[0] + ": sum " + sum + " instead of 100");
  });

  console.log((diffs.length ? "  KO " : "  ok ") + name.padEnd(15)
    + (diffs.length ? diffs.join(" | ") : "16 values match"));
  if (diffs.length) failed++;
}

/* mottos come from OCR, so they are checked against the generated file */
if (fs.existsSync(DATA)) {
  global.window = {};
  require(DATA);
  let sOk = 0, sTotal = 0;
  for (const p of global.window.POLITI_PROFILES || []) {
    const exp = EXPECTED[(p.source || "").replace(/\.png$/i, "")];
    if (!exp || !exp.slogan) continue;
    sTotal++;
    const got = (p.slogan || []).join(" · ");
    if (got === exp.slogan) sOk++;
    else { console.log("  KO motto " + p.alias + ": \"" + got + "\" instead of \"" + exp.slogan + "\""); failed++; }
  }
  console.log("\n  mottos: " + sOk + "/" + sTotal + " match");
} else {
  console.log("\n  profiles-data.js missing — mottos not checked (run tools/extract.js)");
}

console.log("\n" + checked + " values checked, " + failed + " mismatch(es)"
  + (missing ? ", " + missing + " screenshot(s) missing" : ""));
process.exitCode = failed ? 1 : 0;
}
