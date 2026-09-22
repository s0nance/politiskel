# Politiskel

Discover your political skeleton.

Politiskel places political profiles on a two-axis compass — economic left/right
and libertarian/authoritarian — compares them against French parties, and breaks
each profile down axis by axis, so a group can see where it actually diverges
rather than only where its average sits.

It currently reads [PolitiScales](https://politiscales.fr) results. That is the
starting point, not the destination.

## Direction

- **A native test is the goal.** Answering inside Politiskel, no detour and no
  import. The compass, group comparison and party references already work
  independently of where the numbers come from; the questionnaire is what is
  missing.
- **PolitiScales import stays.** It is the fastest way to a real profile today,
  and nobody who already took that test should have to retake anything.
- **Other questionnaires are plausible.** Not implemented.

Only two things are genuinely tied to PolitiScales: `tools/politi-dissect.js`,
which reads its screenshot layout, and the `AXES` table in `template.html`.
Adding another questionnaire is mostly declaring its axes and writing an
importer.

## Privacy

Politiskel runs entirely on your machine — no server, no account, no tracker.

The repository holds code, never profiles. `template.html` is the application
with an empty data slot; the build fills it and writes the page you open. Since
that page is rebuilt on every run, it cannot accumulate data across versions.
Everything derived from your answers is ignored by git — see `.gitignore`.

## Usage

Requires Node, with no dependencies. `tesseract` is optional; without it mottos
are skipped.

1. Drop PolitiScales screenshots into `politi-results/`, named
   `firstname-2026.png` — the filename becomes the profile label.
2. `node tools/extract.js` — reads them, writes the data and assembles
   `index.html`. Only changed screenshots are re-read.
3. Open `index.html`.

You can also drop a screenshot onto the page itself, or type a profile in by
hand. `node tools/verify.js` checks extraction against values read by eye,
stored in `politi-results/fixture.json` (not committed).

## How it reads a screenshot

Percentages come from **bar geometry**, not text: a 5% segment carries no label
at all and would be invisible to OCR. The check is on the neutral share — the
derived value must match the gap measured between the two coloured segments.
Mottos do go through `tesseract`, snapped to a known vocabulary.

## Party positions

Ten of the fifteen references come from the **Chapel Hill Expert Survey 2024**,
whose `lrecon` and `galtan` scales are exactly the two axes used here:
position = (score − 5) × 20. The other five are absent from that survey — too
small, or created after it — and are hand estimates, flagged as such in the
interface.

They indicate an order of magnitude, not a measurement.

## Licence

MIT.
