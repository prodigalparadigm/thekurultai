// Everything you are likely to want to change lives here.
// Pattern lifted from flyer-to-fork, which proved it against real traffic.
export const CONFIG = {
  // --- model ---
  // This document IS the sales artifact: the thesis is that the artifact
  // replaces the audition, so a cheap sketch undercuts the product. Opus 5 is
  // the default for that reason, not by inertia. Sonnet 5 is roughly a fifth
  // the price and is the obvious saving if the sketches read well enough -
  // that is a judgement to make after reading a dozen, not up front.
  // `effort` is rejected by Haiku, so index.mjs only sends it to models
  // that accept it. Switching model here is enough.
  /* LAUNCH WINDOW, 3 Nov 2026 - Kathleen's ruling: Opus 5.5 for the reveal,
     and spend the Anthropic credits rather than hoard them. Was claude-opus-5.
     REVERT TO claude-opus-5 WHEN THE WAVE PASSES, together with the cap below.
     Both are deliberately temporary and both are in this one file. */
  model: "claude-opus-5-5",
  /* Raised from 16000 on 2026-11-01. At effort "high" the thinking tokens
     share this ceiling with the JSON, and a long governance section ran out
     of room mid-string: three stress-test runs died on "Unterminated string
     in JSON at position 30150". The document itself is only ~8-10k output
     tokens; the headroom is for the thinking. */
  maxTokens: 32000,

  // --- what a single request may contain (checked before any spend) ---
  maxFieldChars: 4000,        // per free-text field
  /* The page's own maxlengths add to 12,800 (three 4,000s and the 800-char
     outcome), so a 12,000 ceiling here rejected a buyer who filled in exactly
     what the form let them type. Match the form. */
  maxTotalChars: 12800,       // all fields together

  // --- per-caller token bucket ---
  perIpPerHour: 4,
  perIpBurst: 2,

  // --- polling costs no model tokens, so it gets a roomier bucket ---
  pollPerIpPerHour: 600,
  pollPerIpBurst: 60,

  // --- the cap that actually bounds the bill ---
  // Do the arithmetic before changing this. A QUICK sketch is roughly 3k input
  // and 6-9k output tokens. At Opus 5 list prices that was about $0.55 a run.
  //
  // LAUNCH WINDOW, 3 Nov 2026: raised from 25 to 85 for a $50/day ceiling, on
  // Kathleen's ruling. The arithmetic, stated so it can be checked rather than
  // trusted: 85 x $0.55 = $47, and allowing for the ~10% of runs that take the
  // clause retry and so pay for the model twice, a full day lands near $50.
  //
  // TWO HONEST CAVEATS.
  //  1. This caps RUNS, not DOLLARS. The $50 is an estimate built on Opus 5
  //     prices; Opus 5.5's are not verified here. After the first real day,
  //     read `usage` out of the logs and correct this number rather than
  //     leaving it on an assumption.
  //  2. The second reader adds one Haiku call per run. It is a rounding error
  //     against the above, which is exactly why it runs on Haiku.
  //
  // Earlier note in this file said 25/day was in tension with a $20 budget.
  // That was wrong and is corrected here: the $20 in infra/budget-alarm.sh is
  // an AWS budget covering Lambda, DynamoDB and API Gateway - pennies at this
  // traffic. Model spend is billed to the Anthropic account, which has credit.
  //
  // REVERT TO 25 WHEN THE WAVE PASSES, together with the model above.
  globalRunsPerDay: 85,

  // --- how long a finished document stays fetchable ---
  // Long enough to read and print, short enough that nothing accumulates.
  resultTtlSeconds: 2 * 3600,

  // --- the LOOKS counter, house-wide ---
  // One endpoint, one table, five sites. A site is recognised by the Origin
  // its browser sends; anything not on this list gets a silent 204. Add a
  // site by adding its origins here and putting the beacon on its pages -
  // there is deliberately no per-site infrastructure to stand up.
  //
  // Receipts for these, checked 5 Nov 2026 against the live repos:
  //   prodigalparadigm   comelyhunger/prodigalparadigm   (CNAME is the www form)
  //   euclideanobjects   comelyhunger/euclideanobjects
  //   rippertherecruiter prodigalparadigm/rippertherecruiter  (NOT comelyhunger)
  //   mastersori         prodigalparadigm/mastersori  (apex + www, DNS cut 20 Nov)
  //   flyer2fork         S3 + CloudFront, both .com and .org, both www forms
  lookSites: {
    thekurultai: ["https://thekurultai.com", "https://www.thekurultai.com"],
    prodigalparadigm: ["https://prodigalparadigm.com", "https://www.prodigalparadigm.com"],
    euclideanobjects: ["https://euclideanobjects.com", "https://www.euclideanobjects.com"],
    rippertherecruiter: ["https://rippertherecruiter.com", "https://www.rippertherecruiter.com"],
    mastersori: ["https://mastersori.com", "https://www.mastersori.com"],
    flyer2fork: ["https://flyer2fork.com", "https://www.flyer2fork.com",
                 "https://flyer2fork.org", "https://www.flyer2fork.org"],
    /* The QA harness has to prove that counting actually COUNTS, which means
       firing a look that is really counted. Doing that against a real site
       would put harness traffic into a number she quotes out loud, so the
       probe gets its own site with NO origins: it is unreachable from any
       browser and only addressable as s=qa. Reports skip any site with an
       empty origin list, so this one can never reach the TOTAL line. */
    qa: [],
  },
  // Raw per-day rows delete themselves. The monthly rollup has no TTL, so the
  // number she quotes outlives the rows it was computed from.
  lookTtlDays: 90,
  // A look costs no model tokens, so the bucket is roomy - but it is a bucket,
  // because an open counter is still an open write path to her table.
  lookPerIpPerHour: 300,
  lookPerIpBurst: 60,
  // A day's looker set lives in one item and an item is capped at 400KB. At
  // this cap the row keeps counting views, stops adding lookers, and says so.
  lookDistinctCap: 5000,

  // --- where things live ---
  ssmKeyParam: process.env.SSM_KEY_PARAM || "/kurultai/anthropic-api-key",
  tableName: process.env.LIMITS_TABLE || "KurultaiLimits",
  selfFunction: process.env.SELF_FUNCTION || "kurultai-engine",

  // The page is served from GitHub Pages, so the API is cross-origin and needs
  // real CORS. A wildcard is sloppy, so the request's Origin is echoed back
  // only when it is on this list.
  allowOrigins: (process.env.ALLOW_ORIGINS ||
    "https://thekurultai.com,https://www.thekurultai.com,https://prodigalparadigm.github.io"
  ).split(",").map((s) => s.trim()).filter(Boolean),
};
