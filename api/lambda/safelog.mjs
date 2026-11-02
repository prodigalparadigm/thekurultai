/* What may be said about a failure, in a log that outlives the document.

   `run_failed` used to log 600 characters of the upstream error message. The
   key was never the risk - Anthropic does not echo credentials - but a 400
   that quotes the field it rejected can carry a fragment of what the buyer
   typed, and CloudWatch outlives the two hours the page promises. The page
   says "no record you did not take with you", so that fragment was the one
   way the sentence could have been false.

   So the detail is no longer COPIED out of the message. It is RECOGNISED in
   it: every piece of the line below comes from a pattern that can only match
   structure, and anything unrecognised is dropped rather than truncated.

   An allowlist, deliberately, not a denylist. Scrubbing the intake out of the
   message would have to be right about every fragment of prose a buyer could
   write; this has to be right about the handful of shapes worth logging, and
   a shape it has never seen reads as "withheld" - which is an invitation to
   widen the list, not a leak. The guarantee that does the real work is in the
   character classes: none of them admit a space, so no pattern here can carry
   a sentence even if the API hands one over. */

const ERROR_TYPES = new Set([
  "invalid_request_error", "authentication_error", "permission_error",
  "not_found_error", "request_too_large", "rate_limit_error",
  "api_error", "overloaded_error", "billing_error", "timeout_error",
]);

/* The request fields an API 400 can complain about. Rooted, so a path has to
   start at one of these to be logged at all. */
const PATH_ROOTS = "messages|system|model|max_tokens|output_config|tools|tool_choice" +
                   "|metadata|temperature|top_p|top_k|stop_sequences|thinking|stream";
const PATH = new RegExp("\\b(?:" + PATH_ROOTS + ")(?:\\.[A-Za-z_][A-Za-z0-9_]*|\\[\\d+\\]|\\.\\d+)*", "");

/* The truncation family, which is the failure this product actually hits.
   Position is a number, so it travels. */
const JSON_SHAPES = [
  [/Unterminated string in JSON at position (\d+)/i, "unterminated_string"],
  [/Unexpected end of JSON/i,                        "unexpected_end"],
  [/Failed to parse structured output/i,             "unparsed_structured_output"],
  [/Expected .{0,12} in JSON at position (\d+)/i,    "unexpected_token"],
];

const IDENT = /^[A-Za-z][A-Za-z0-9]{0,39}$/;        // class names: TypeError, APIError
const CODE = /^[A-Z][A-Z0-9_]{2,31}$/;              // node/network: ECONNRESET, ETIMEDOUT
const REQ_ID = /^req_[A-Za-z0-9]{8,48}$/;           // Anthropic request id, no content

/* A bounded, space-free description of a failure. Safe to log. */
export function safeDetail(e) {
  const msg = String(e?.message ?? "");
  const out = {};

  if (Number.isInteger(e?.status)) out.status = e.status;

  /* A bare "Error" is the name of every anonymous throw, so it says nothing
     and would mask the "withheld" signal below. */
  if (IDENT.test(String(e?.name ?? "")) && e.name !== "Error") out.name = e.name;
  if (CODE.test(String(e?.code ?? ""))) out.code = e.code;

  /* The API's own error type, taken from the parsed body when the SDK gives
     one and otherwise recognised in the message against the fixed set above.
     Never whatever word happened to sit in that position. */
  const declared = e?.error?.error?.type ?? e?.error?.type;
  if (ERROR_TYPES.has(declared)) out.type = declared;
  else {
    for (const t of ERROR_TYPES) {
      if (msg.includes(t)) { out.type = t; break; }
    }
  }

  const path = PATH.exec(msg);
  if (path) out.at = path[0].slice(0, 64);

  for (const [re, label] of JSON_SHAPES) {
    const m = re.exec(msg);
    if (m) {
      out.json = label;
      if (m[1]) out.pos = Number(m[1]);
      break;
    }
  }

  const reqId = e?.request_id ?? e?.requestID ?? e?.headers?.["request-id"];
  if (REQ_ID.test(String(reqId ?? ""))) out.request_id = reqId;

  /* Said out loud, so a failure nobody can read is visible as a gap in this
     list rather than as an error with no detail. */
  if (!Object.keys(out).length) out.detail = "withheld";
  return out;
}
