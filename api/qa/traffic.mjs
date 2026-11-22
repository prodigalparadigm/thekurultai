#!/usr/bin/env node
/* "What's your traffic?" - the answer, for the whole house.
 *
 *   node api/qa/traffic.mjs          the last 30 days
 *   node api/qa/traffic.mjs 7        the last 7 days
 *
 * Reads the LOOKS counter's own rows out of DynamoDB. Costs nothing but a
 * handful of GetItems; no model call, nothing against the daily cap.
 *
 * WHAT THIS NUMBER IS. A look is one beacon that a browser sent us on page
 * load. It is not an audited figure and it does not try to be: QA traffic is
 * excluded, bots that run no JavaScript are invisible, a reader who blocks
 * the request is uncounted, and anything that is not a browser can forge the
 * origin it claims. Quote it as "looks", which is what it measures.
 *
 * WHAT IT CANNOT BE. Distinct lookers are distinct PER DAY PER SITE, because
 * the hash that recognises a repeat visit is salted with a key that rotates
 * daily and is never joined across sites. So distinct figures do not add up -
 * not across days, not across sites. That is the privacy promise working as
 * designed, not a gap: counting weekly uniques would mean keeping an
 * identifier that outlives the day, and this house does not keep one.
 *
 * Looks DO add. The TOTAL line adds looks and refuses to add distincts.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG } from "../lambda/config.mjs";
import { lookKeys, utcDay, utcMonth } from "../lambda/look.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REGION = "us-east-1", TABLE = CONFIG.tableName;
const DAYS = Math.max(1, Math.min(90, Number(process.argv[2] || 30)));
/* Only sites a browser can actually reach. The qa site in config.mjs has no
   origins on purpose - it exists so the harness can fire a genuinely counted
   look without putting harness traffic into a figure she quotes. */
const SITES = Object.keys(CONFIG.lookSites).filter((s) => CONFIG.lookSites[s].length > 0);
/* The domain to print for a site key. The first origin on its allowlist is
   the canonical one, so the report says "www.prodigalparadigm.com" if that is
   what the CNAME says, rather than inventing a bare form. */
const domainOf = (s) => CONFIG.lookSites[s][0].replace(/^https:\/\//, "");

const aws = (args) => {
  try {
    return execFileSync("aws", [...args, "--region", REGION],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  } catch { return ""; }
};
const warn = [];

/* ---------- read ----------
   Keys are deterministic, so every read here is a GetItem in a batch. No Scan
   touches this table: a Scan would also walk the rate limiter's rows, which
   are none of a traffic report's business. */
const day = (n) => utcDay(new Date(Date.now() - n * 864e5));
const days = Array.from({ length: DAYS }, (_, i) => day(DAYS - 1 - i));
const today = day(0);

function batchGet(keys, projection) {
  const found = new Map();
  for (let i = 0; i < keys.length; i += 25) {          // the API's hard limit
    const chunk = keys.slice(i, i + 25);
    const req = {
      [TABLE]: {
        Keys: chunk.map((pk) => ({ pk: { S: pk } })),
        ...(projection
          ? { ProjectionExpression: "pk, #v", ExpressionAttributeNames: { "#v": "v" } }
          : {}),
      },
    };
    const out = aws(["dynamodb", "batch-get-item", "--request-items", JSON.stringify(req), "--output", "json"]);
    if (!out) { warn.push("a read of the counter failed - figures below may be short"); continue; }
    let parsed;
    try { parsed = JSON.parse(out); } catch { warn.push("unreadable reply from DynamoDB"); continue; }
    for (const it of parsed?.Responses?.[TABLE] || []) found.set(it.pk.S, it);
    /* Unprocessed keys mean throttling. Say so rather than quietly under-report. */
    if (Object.keys(parsed?.UnprocessedKeys || {}).length)
      warn.push("DynamoDB left some keys unread (throttling) - figures may be short");
  }
  return found;
}

/* views per site per day: the whole window, numbers only - the looker sets
   are deliberately not pulled, they can be large and are not needed here */
const dayKeys = SITES.flatMap((s) => days.map((d) => `lookday#${s}#${d}`));
const views = batchGet(dayKeys, true);
const viewsOf = (site, d) => Number(views.get(`lookday#${site}#${d}`)?.v?.N || 0);

/* today in full, because the distinct count needs the day's set */
const todayFull = batchGet(SITES.map((s) => `lookday#${s}#${today}`), false);
const distinctToday = (site) => {
  const it = todayFull.get(`lookday#${site}#${today}`);
  return { n: (it?.d?.SS || []).length, capped: it?.capped?.BOOL === true };
};

/* when did counting begin? The monthly rows have NO TTL, so the month is
   knowable forever; the exact day survives as long as the daily rows do.
   Nothing here is estimated - if the rows cannot say, the report says so. */
const monthsBack = 24;
const monthKeys = SITES.flatMap((s) =>
  Array.from({ length: monthsBack }, (_, i) => {
    const dt = new Date(); dt.setUTCDate(1); dt.setUTCMonth(dt.getUTCMonth() - i);
    return `lookmonth#${s}#${utcMonth(dt)}`;
  }));
const months = batchGet(monthKeys, false);
function beganFor(site) {
  const ms = [...months.keys()].filter((k) => k.startsWith(`lookmonth#${site}#`))
    .map((k) => k.split("#")[2]).sort();
  if (!ms.length) return null;
  const firstDay = days.find((d) => viewsOf(site, d) > 0);
  /* Prefer the exact day when the daily row is still alive; fall back to the
     month, which never expires. Never invent a date. */
  return firstDay && firstDay.startsWith(ms[0]) ? firstDay : ms[0];
}

/* ---------- report ---------- */
const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);

console.log(`\nTHE LOOKS COUNTER - last ${DAYS} day(s), through ${today} (UTC)`);
console.log("  A look is one beacon a browser sent on page load. QA is excluded.");

let anyData = false;
const rows = SITES.map((site) => {
  const t = viewsOf(site, today);
  const w = days.slice(-Math.min(7, DAYS)).reduce((a, d) => a + viewsOf(site, d), 0);
  const m = days.reduce((a, d) => a + viewsOf(site, d), 0);
  let best = { d: null, v: 0 };
  for (const d of days) { const v = viewsOf(site, d); if (v > best.v) best = { d, v }; }
  const dist = distinctToday(site);
  const began = beganFor(site);
  if (m || began) anyData = true;
  return { site, t, w, m, best, dist, began };
});

/* The window is an argument, so the headings have to be too - a column
   labelled "30 DAYS" that holds seven days of looks is how a wrong number
   gets quoted out loud. */
const WEEK = Math.min(7, DAYS);
/* With a window of a week or less the "7 days" and "window" columns are the
   same column, and printing it twice invites reading one of them as a bigger
   number than it is. */
const showWeek = DAYS > 7;
console.log("\n" + pad("SITE", 24) + num("TODAY", 7) + (showWeek ? num("7 DAYS", 8) : "")
  + num(`${DAYS} DAYS`, 9) + "  " + pad("BEST DAY", 22) + "DISTINCT TODAY");
for (const r of rows) {
  const best = r.best.d ? `${r.best.v} on ${r.best.d}` : "-";
  const dist = r.began ? (r.dist.capped ? `${r.dist.n}+` : String(r.dist.n)) : "-";
  console.log(pad(domainOf(r.site), 24) + num(r.t, 7) + (showWeek ? num(r.w, 8) : "")
    + num(r.m, 9) + "  " + pad(best, 22) + num(dist, 14));
}
const sum = (f) => rows.reduce((a, r) => a + f(r), 0);
console.log(pad("TOTAL", 24) + num(sum((r) => r.t), 7)
  + (showWeek ? num(sum((r) => r.w), 8) : "") + num(sum((r) => r.m), 9)
  + "  " + pad("-", 22) + num("not addable", 14));

/* ---------- what each figure may and may not be used for ---------- */
console.log("\nCOUNTING BEGAN");
for (const r of rows) {
  if (r.began) console.log(`  ${pad(domainOf(r.site), 24)}${r.began}`);
  else console.log(`  ${pad(domainOf(r.site), 24)}nothing counted yet`);
}
console.log("  Days before a site's start read as zero because nothing was counted,");
console.log("  not because nobody came. Do not quote a window that predates the start.");

console.log("\nWHAT NOT TO SAY");
console.log("  Distinct figures are per day AND per site, because the recognising hash is");
console.log("  salted with a key that rotates daily and is never shared between sites.");
console.log("  They cannot be summed into a weekly or estate-wide unique count. The one");
console.log("  honest estate number is the looks TOTAL above.");
if (rows.some((r) => r.dist.capped)) {
  console.log("  A site shows N+ today: its day's looker set hit the cap in config.mjs,");
  console.log("  so that distinct figure is a floor, not a total. Looks are still exact.");
}
console.log("\n  GitHub repo views and clones are a DIFFERENT population - people browsing");
console.log("  the source, not readers of the site. They live in their own report:");
console.log("    python3 ~/claude_system/admin_run/github_traffic.py");
console.log("  Never add them to the figures above.");

/* ---------- maintain the rollup that outlives the rows ----------
   The daily rows expire at 90 days; the monthly rows never do. Views are
   carried onto the month by the endpoint itself. A maximum cannot be computed
   by an atomic increment, so today's distinct high-water mark is written here,
   on every run. The honest consequence, stated rather than hidden: a day that
   expired without this command ever running contributes its views to the
   month and not its distinct count. */
if (anyData) {
  let written = 0;
  for (const r of rows) {
    if (!r.dist.n) continue;
    const pk = lookKeys(r.site, "/", new Date()).month;
    const out = aws(["dynamodb", "update-item", "--table-name", TABLE,
      "--key", JSON.stringify({ pk: { S: pk } }),
      "--update-expression", "SET maxd = :v",
      "--condition-expression", "attribute_not_exists(maxd) OR maxd < :v",
      "--expression-attribute-values", JSON.stringify({ ":v": { N: String(r.dist.n) } })]);
    if (out !== "") written++;   // a failed condition is normal, not an error
  }
  if (written) console.log(`\n  (monthly high-water mark updated for ${written} site(s))`);
}

/* A counter with nothing in it is a finding, not a clean bill of health. It
   said "NOTHING WRONG" under a table of zeros once; it does not again. */
if (!anyData) warn.push(
  "the counter has recorded nothing at all - either the beacon is not deployed yet,\n" +
  "    or /look is not reachable. Check with: node api/qa/harness.mjs --looks");
console.log("\n" + (warn.length ? "WORTH LOOKING AT" : "NOTHING WRONG"));
for (const w of warn) console.log("  - " + w);
console.log();
