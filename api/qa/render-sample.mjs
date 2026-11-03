#!/usr/bin/env node
/* Regenerate editions/sample-harbour-freight.html - the pre-rendered document
 * behind "See the finished document" on the landing page.
 *
 * Two halves, and only the first can be automated here.
 *
 *   1. ASK THE ENGINE.  Sends the DEMO cast from app.js to the live endpoint
 *      and saves what comes back as editions/sample-harbour-freight.json.
 *      This costs one run against the daily cap and about $0.25.
 *
 *   2. RENDER IT.  The markup in the shipped page is the output of the site's
 *      own renderDocument(), captured from a browser and committed, so the
 *      sample cannot drift from what a real run produces and the page needs
 *      no JavaScript to read. That needs a browser, so it is printed as steps
 *      rather than run.
 *
 * Usage:
 *   node api/qa/render-sample.mjs            # print the steps only
 *   node api/qa/render-sample.mjs --fetch    # also spend a run on a fresh document
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const app = readFileSync(join(ROOT, "app.js"), "utf8");
const ENDPOINT = (/const KURULTAI_ENDPOINT = "([^"]+)"/.exec(app) || [])[1];

/* Rebuild the payload the page would send, from the same DEMO cast
   api/qa/harness.mjs checks against the ordinary-intake fixture. Reading it
   out of app.js rather than restating it here is the whole point: one cast. */
const grab = (n) => {
  const m = new RegExp(`${n}:\\s*'((?:[^'\\\\]|\\\\.)*)'`).exec(app);
  return m ? m[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\") : null;
};
const dial = (n) => Number((new RegExp(`dials:\\s*{[^}]*\\b${n}:\\s*(\\d+)`).exec(app) || [])[1]);
const payload = {
  company: {
    name: grab("organization"),
    industry: [grab("sector"), grab("industry")].filter(Boolean).join(" - "),
    size: grab("size"),
    regulated: /regulated:\s*'yes'/.test(app),
  },
  processes: grab("processes"),
  current_ai: grab("current_ai"),
  staffing: grab("staffing_text"),
  outcome_90: grab("priority"),
  sliders: {
    staffing: 100 - dial("staffing"),
    data_governance: 100 - dial("governance"),
    risk_tolerance: 100 - dial("risk"),
    upfront_investment: 100 - dial("investment"),
  },
  demo: true,
};

const JSON_PATH = join(ROOT, "editions", "sample-harbour-freight.json");

if (process.argv.includes("--fetch")) {
  if (!ENDPOINT) { console.error("No KURULTAI_ENDPOINT in app.js."); process.exit(1); }
  console.log("Asking the engine (one run against the daily cap, ~$0.25)...");
  const r = await fetch(ENDPOINT, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const booked = await r.json();
  if (!r.ok || !booked.id) { console.error("Not accepted:", booked); process.exit(1); }
  console.log("  booked " + booked.id);
  let out;
  for (let i = 0; i < 120; i++) {
    await new Promise((s) => setTimeout(s, 5000));
    const p = await fetch(`${ENDPOINT}?id=${booked.id}`);
    const j = await p.json();
    if (j.status === "running") { process.stdout.write(`\r  ${j.stage || "running"} (${i * 5}s)   `); continue; }
    out = j; break;
  }
  console.log();
  if (out?.status !== "done") { console.error("Did not finish:", out); process.exit(1); }
  writeFileSync(JSON_PATH, JSON.stringify(out.document, null, 2) + "\n");
  console.log("  wrote editions/sample-harbour-freight.json");
  console.log("  demo flag echoed by the engine: " + (out.demo === true));
} else {
  console.log("Payload the page would send (pass --fetch to spend a run on a fresh one):\n");
  console.log(JSON.stringify(payload, null, 2));
}

console.log(`
Now render it. The markup has to come from the real renderDocument():

  1. Serve the repo:        python3 -m http.server 8791 --bind 127.0.0.1
  2. Make a scratch page at editions/_render-sample.html with the site chrome,
     an empty <main id="main">, <script src="../app.js" defer>, and inline:

       const DOC = <contents of sample-harbour-freight.json>;
       document.addEventListener('DOMContentLoaded', function () {
         renderDocument(DOC, { demo: true, date: '<today, "November 3, 2026">',
                               restartHref: '../index.html#instrument' });
       });

  3. Open http://127.0.0.1:8791/editions/_render-sample.html, then copy
     document.querySelector('#main').innerHTML - first setting the print
     button's id to "print-report" so app.js still wires it on the static page.
  4. Paste that inside <main id="main"> in editions/sample-harbour-freight.html,
     keeping the head, the header and the how-this-is-made comment.
  5. Delete the scratch page and run:  node api/qa/harness.mjs

The harness checks the shipped page for the banner, for static (not
script-drawn) markup, and for the structures renderDocument produces, so step 5
is what tells you the capture worked.`);
