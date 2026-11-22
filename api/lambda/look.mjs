import { createHash, randomUUID } from "node:crypto";
import { CONFIG } from "./config.mjs";

/* The LOOKS counter. One endpoint for the whole house.
 *
 * The promise on the page is that the site stores nothing but a count, and
 * that stays literally true here: every item this module writes is a number
 * or a set of day-scoped hashes. No addresses, no user agents, no cookies,
 * no localStorage, no third-party script.
 *
 * This half deliberately imports no AWS SDK. The SDK is provided by the
 * Lambda runtime and is not installed in lambda/node_modules, so anything
 * that imports it cannot be run on a laptop or by the QA harness - which is
 * how clause.mjs and safelog.mjs ended up SDK-free too. The writes live in
 * lookstore.mjs. Everything here is testable without an AWS account.
 *
 * Distinct counting reuses the limiter's trick with one difference that
 * matters: the salt ROTATES DAILY. Yesterday's looker and today's hash to
 * different values, so the rows cannot be joined across days even by us.
 * The honest consequence, which the reports state out loud: "distinct" means
 * distinct-per-day. We cannot count weekly uniques, because counting them
 * would mean holding an identifier that outlives the day. That is the trade
 * taken deliberately, not a gap to close later.
 */

/* Same secret as the limiter, same reason: this file is in a public repo, and
   a known salt turns a hash of an IPv4 address back into the address by
   precomputation. Set at deploy time from SSM. The fallback is random per
   cold start, which costs a little accuracy and never silently reinstates a
   published salt. */
const SALT = process.env.IP_SALT || ("ephemeral-" + randomUUID());

export const utcDay = (d = new Date()) => d.toISOString().slice(0, 10);
export const utcMonth = (d = new Date()) => d.toISOString().slice(0, 7);

/* The day's salt is derived, not stored. Deriving it means there is no second
   secret to rotate and no window where an old salt lingers in a parameter. */
const daySalt = (day) =>
  createHash("sha256").update(SALT + "|look|" + day).digest("hex");

/* 48 bits of a salted hash. Enough that collisions are not a practical
   concern at house traffic (a few thousand lookers a day), short enough that
   the day's set stays small. It is not reversible to an address and it is
   worthless tomorrow. */
export const lookerFor = (ip, day) =>
  createHash("sha256").update(daySalt(day) + "|" + ip).digest("hex").slice(0, 12);

/* ---- which site is this? ----
   One endpoint serves five sites, so the item has to record which one. The
   answer comes from the request's Origin, checked against the allowlist in
   config.mjs. Anything not on the list gets a silent 204 - an unrecognised
   caller learns nothing about what the list contains.

   An explicit s=<site> is honoured when it names an allowlisted site, because
   the QA harness has no Origin to send. This is not a hole worth closing:
   Origin is forgeable by anything that is not a browser, so site attribution
   was never cryptographic. What bounds abuse is the rate limiter, and what
   the number honestly means - "beacons a browser sent us" - is stated in the
   reports rather than overclaimed. */
const ORIGIN_TO_SITE = Object.fromEntries(
  Object.entries(CONFIG.lookSites).flatMap(([site, origins]) =>
    origins.map((o) => [o.toLowerCase(), site])));

export function siteFor(origin, sParam) {
  if (sParam && Object.hasOwn(CONFIG.lookSites, sParam)) return sParam;
  return ORIGIN_TO_SITE[String(origin || "").toLowerCase()] || null;
}

/* ---- which page? ----
   The path travels as p=<path>. Junk must not be able to invent unbounded
   rows, so anything that is not shaped like one of our pages is folded into
   the single bucket "other" rather than dropped: the look still counts
   towards the site total, and the row count stays bounded by the number of
   real page names. Query strings and fragments are cut before the item is
   keyed, because "/report.html?utm_source=..." is one page, not a thousand. */
export function normalizePath(p) {
  let s = String(p || "/").split("?")[0].split("#")[0].toLowerCase();
  if (!s.startsWith("/")) s = "/" + s;
  if (s.length > 80) return "other";
  if (!/^\/[a-z0-9._\/-]*$/.test(s)) return "other";
  if (s.includes("..")) return "other";
  if (!(s.endsWith("/") || s.endsWith(".html"))) return "other";
  return s;
}

/* The three keys a single look touches. Deterministic, so reading them back
   later is a GetItem and never a Scan - a Scan over this table would also
   walk the limiter's rows, which is both slow and none of a report's
   business. */
export const lookKeys = (site, path, when = new Date()) => ({
  page: `look#${site}#${path}#${utcDay(when)}`,
  day: `lookday#${site}#${utcDay(when)}`,
  month: `lookmonth#${site}#${utcMonth(when)}`,
});
