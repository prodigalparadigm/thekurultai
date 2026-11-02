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
  model: "claude-opus-5",
  /* Raised from 16000 on 2026-11-01. At effort "high" the thinking tokens
     share this ceiling with the JSON, and a long governance section ran out
     of room mid-string: three stress-test runs died on "Unterminated string
     in JSON at position 30150". The document itself is only ~8-10k output
     tokens; the headroom is for the thinking. */
  maxTokens: 32000,

  // --- what a single request may contain (checked before any spend) ---
  maxFieldChars: 4000,        // per free-text field
  maxTotalChars: 12000,       // all fields together

  // --- per-caller token bucket ---
  perIpPerHour: 4,
  perIpBurst: 2,

  // --- polling costs no model tokens, so it gets a roomier bucket ---
  pollPerIpPerHour: 600,
  pollPerIpBurst: 60,

  // --- the cap that actually bounds the bill ---
  // Do the arithmetic before raising this. A QUICK sketch is roughly 3k input
  // and 6-9k output tokens. At Opus 5 list prices that is about $0.55 a run,
  // so 25/day is roughly $14 on a day that fills. Sonnet 5 is about $0.11 a
  // run, so the same cap is about $3. Raise it only after watching `usage`
  // in the logs for a week of real runs.
  globalRunsPerDay: 25,

  // --- how long a finished document stays fetchable ---
  // Long enough to read and print, short enough that nothing accumulates.
  resultTtlSeconds: 2 * 3600,

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
