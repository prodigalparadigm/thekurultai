#!/usr/bin/env node
/* Is anyone using it, and is it still working.
 *
 * Costs nothing. No model call, no run against the daily cap. It reads the
 * counters the engine already keeps, checks the pages are served, and pokes
 * the endpoint with a deliberately bad job id - which proves API Gateway and
 * the Lambda are alive and answering, for free.
 *
 *   node api/qa/status.mjs          today
 *   node api/qa/status.mjs 3        the last 3 days
 *
 * Privacy: the engine logs shape and never content, so nothing here can show
 * what anyone typed. Visitors are counted as salted hashes, which is all the
 * rate limiter ever stores. There is no way to get a person out of this.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DAYS = Math.max(1, Number(process.argv[2] || 1));
const REGION = "us-east-1", FN = "kurultai-engine", TABLE = "KurultaiLimits";
const SITE = "https://thekurultai.com";
const cfg = readFileSync(join(ROOT, "lambda", "config.mjs"), "utf8");
const ENDPOINT = (/const KURULTAI_ENDPOINT = "([^"]+)"/.exec(
  readFileSync(join(ROOT, "..", "app.js"), "utf8")) || [])[1];
const CAP = Number((/globalRunsPerDay: (\d+)/.exec(cfg) || [, 0])[1]);
const MODEL = (/model: "([^"]+)"/.exec(cfg) || [, "?"])[1];

const aws = (args) => {
  try { return execFileSync("aws", [...args, "--region", REGION], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return ""; }
};
const warn = [];

/* ---------- is it serving? ---------- */
console.log("\nTHE SITE");
const pages = ["/", "/editions/", "/editions/sample-harbour-freight.html", "/report.html", "/patron.html"];
for (const p of pages) {
  let code = "---";
  try { code = String((await fetch(SITE + p, { redirect: "follow" })).status); } catch { code = "unreachable"; }
  console.log(`  ${code === "200" ? "ok  " : "DOWN"}  ${SITE}${p}  ${code}`);
  if (code !== "200") warn.push(`${p} returned ${code}`);
}

/* ---------- is the engine answering? ---------- */
console.log("\nTHE ENGINE");
if (!ENDPOINT) { console.log("  no endpoint in app.js"); warn.push("no endpoint configured"); }
else {
  try {
    const r = await fetch(`${ENDPOINT}?id=not-a-real-id`);
    const j = await r.json().catch(() => ({}));
    /* A clean 400 is the healthy answer: the gateway routed, the function
       ran, and it rejected a bad id the way it should. */
    const good = r.status === 400 && j.error === "bad_id";
    console.log(`  ${good ? "ok  " : "BAD "}  answering  (${r.status} ${j.error || ""})`);
    if (!good) warn.push(`endpoint answered ${r.status}, expected a 400 bad_id`);
  } catch (e) { console.log("  DOWN  endpoint unreachable"); warn.push("endpoint unreachable"); }
}
const live = aws(["lambda", "get-function-configuration", "--function-name", FN,
  "--query", "[LastUpdateStatus,State,LastModified]", "--output", "text"]).trim();
console.log(`  deployed  ${MODEL}, cap ${CAP}/day  ${live ? "(" + live.replace(/\s+/g, " ") + ")" : ""}`);

/* ---------- has anyone used it? ---------- */
const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
console.log("\nUSE");
for (let i = DAYS - 1; i >= 0; i--) {
  const d = day(i);
  const out = aws(["dynamodb", "get-item", "--table-name", TABLE,
    "--key", JSON.stringify({ pk: { S: "global#" + d } }), "--output", "json"]);
  const used = Number(JSON.parse(out || "{}")?.Item?.reads?.N || 0);
  const bar = "#".repeat(Math.min(40, used)) || "-";
  const pct = CAP ? Math.round(used / CAP * 100) : 0;
  console.log(`  ${d}  ${String(used).padStart(3)} / ${CAP} runs  ${String(pct).padStart(3)}%  ${bar}`);
  if (i === 0 && CAP && used >= CAP * 0.8) warn.push(`today is at ${pct}% of the daily cap`);
}
const ips = (aws(["dynamodb", "scan", "--table-name", TABLE,
  "--projection-expression", "pk", "--query", "Items[].pk.S", "--output", "text"]) || "")
  .split(/\s+/).filter((k) => k.startsWith("ip#")).length;
console.log(`  ${ips} distinct visitor(s) have booked a run inside the limiter's window`);
console.log("  (salted hashes, not addresses - this cannot name anybody)");

/* ---------- what happened on those runs? ---------- */
console.log("\nOUTCOMES");
const since = Date.now() - DAYS * 864e5;
const lines = (aws(["logs", "filter-log-events", "--log-group-name", `/aws/lambda/${FN}`,
  "--start-time", String(since), "--filter-pattern", "STAT",
  "--query", "events[].message", "--output", "text"]) || "")
  .split(/\t|\n/).filter((l) => l.startsWith("STAT "))
  .map((l) => { try { return JSON.parse(l.slice(5)); } catch { return null; } }).filter(Boolean);

if (!lines.length) console.log("  no runs in this window.");
else {
  const n = (what) => lines.filter((l) => l.what === what).length;
  const done = lines.filter((l) => l.what === "run_done");
  const failed = lines.filter((l) => l.what === "run_failed");
  console.log(`  ${n("run_started")} started, ${done.length} finished, ${failed.length} failed`);
  if (failed.length) {
    const why = {};
    for (const f of failed) why[f.kind || "?"] = (why[f.kind || "?"] || 0) + 1;
    console.log("  failures: " + Object.entries(why).map(([k, v]) => `${v} ${k}`).join(", "));
    warn.push(`${failed.length} run(s) failed`);
  }
  if (done.length) {
    const ms = done.map((d) => d.ms).sort((a, b) => a - b);
    const tokens = done.reduce((t, d) => t + (d.output || 0), 0);
    console.log(`  median ${Math.round(ms[Math.floor(ms.length / 2)] / 1000)}s, slowest ${Math.round(ms[ms.length - 1] / 1000)}s`);
    console.log(`  ${tokens.toLocaleString()} output tokens across ${done.length} document(s)`);
  }
  const capped = n("daily_cap_hit"), limited = n("run_rate_limited");
  if (capped) { console.log(`  ${capped} visitor(s) turned away at the daily cap`); warn.push(`${capped} turned away at the cap`); }
  if (limited) console.log(`  ${limited} slowed down by the per-visitor limit`);

  /* John's Clause, all three layers. */
  console.log("\nJOHN'S CLAUSE");
  console.log(`  ${n("clause_breach")} draft(s) caught by the regex, ${done.filter((d) => d.retried).length} rewritten and recovered`);
  const reads = n("reader_done"), caught = n("reader_caught");
  const mute = n("reader_no_output"), gone = n("reader_unavailable");
  console.log(`  second reader: ran on ${reads} document(s), flagged ${caught}`);
  if (mute) { console.log(`  ${mute} read(s) came back with NO OUTPUT - the reader is not working`); warn.push("the second reader returned no output"); }
  if (gone) { console.log(`  ${gone} read(s) could not reach the model`); warn.push("the second reader was unreachable"); }
  if (!reads && done.length) {
    console.log("  the reader did not run on any finished document");
    warn.push("the second reader is not running - John's Clause is on two layers");
  }
}

/* ---------- the launch window, which is temporary ---------- */
if (MODEL !== "claude-opus-5" || CAP !== 25)
  warn.push(`launch-window settings still in force (${MODEL}, ${CAP}/day) - revert in api/lambda/config.mjs`);

console.log("\n" + (warn.length ? "WORTH LOOKING AT" : "NOTHING WRONG"));
for (const w of warn) console.log("  - " + w);
console.log();
