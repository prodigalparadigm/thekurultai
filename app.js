/* The Kurultai - the instrument, and the document it returns.
 *
 * The slider behavior and its accessibility semantics are the concept's and
 * are kept as they were: vertical scales, explicit keyboard direction, both
 * full sentences read out, no position called good or bad.
 *
 * What is new is everything after submit. The concept demonstrated the waiting
 * state with a timer; this talks to the engine in api/, which takes minutes,
 * so the page books a job and polls for it.
 *
 * Model output is rendered with textContent, never innerHTML. It is written
 * from text a stranger typed, and it goes on Kathleen's domain.
 */

/* ------------------------------------------------------------------
   Set this to the endpoint infra/deploy.sh prints (it ends in /run).
   Until it is set the page says so plainly rather than failing oddly.
   ------------------------------------------------------------------ */
const KURULTAI_ENDPOINT = "https://mhzitp8tad.execute-api.us-east-1.amazonaws.com/run";

const $ = (s) => document.querySelector(s);
/* Used by the reading room as well as the document, so it is declared up
   here: the reading room is built at load, and a const is not hoisted. */
const el = (tag, props = {}, kids = []) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of [].concat(kids)) if (k !== null && k !== undefined) n.append(k);
  return n;
};

/* ---------------- the instrument ---------------- */
const ranges = [...document.querySelectorAll('input[type="range"]')];
function describe(range) {
  const value = Number(range.value);
  const top = $(`#${range.id}-top`).textContent;
  const bottom = $(`#${range.id}-bottom`).textContent;
  const side = value === 50 ? 'Center position'
    : `${Math.abs(value - 50) * 2}% toward the ${value > 50 ? 'top' : 'bottom'} statement`;
  range.setAttribute('aria-valuetext', `${side}. Top: ${top}. Bottom: ${bottom}.`);
  $(`#${range.id}-state`).textContent = side;
  const readout = range.parentElement.querySelector('.thumb-readout');
  readout.textContent = value;
  readout.style.top = `calc(24px + (100% - 48px) * ${(100 - value) / 100})`;
  return side;
}
ranges.forEach((range) => {
  describe(range);
  range.addEventListener('input', () => describe(range));
  // Keep keyboard direction explicit across engines: higher is physically upward.
  range.addEventListener('keydown', (e) => {
    const adjustments = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 10, PageDown: -10 };
    if (e.key in adjustments) {
      e.preventDefault();
      range.value = Math.max(0, Math.min(100, Number(range.value) + adjustments[e.key]));
      describe(range);
    }
    if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      range.value = e.key === 'Home' ? 0 : 100;
      describe(range);
    }
  });
});
$('#reset-ranges')?.addEventListener('click', () => {
  ranges.forEach((r) => { r.value = 50; describe(r); });
  ranges[0].focus();
});

/* ---------------- the four engines ----------------
   These descriptions used to live here as HTML strings written in with
   innerHTML. An AEO review found the consequence: a crawler that does not run
   JavaScript saw four tab labels and no explanation of what the product does,
   on the page an answer engine reads first. They are static HTML now, and this
   only shows and hides them. */
const PANELS = ["ceremony", "ledger", "people", "staffing"];
document.querySelectorAll("[data-preview]").forEach((btn) => btn.addEventListener("click", () => {
  const want = btn.dataset.preview;
  document.querySelectorAll("[data-preview]").forEach((other) => {
    const on = other === btn;
    other.classList.toggle("selected", on);
    other.setAttribute("aria-pressed", String(on));
  });
  PANELS.forEach((k) => {
    const panel = document.getElementById("preview-" + k);
    if (panel) panel.hidden = k !== want;
  });
}));

/* ---------------- submit, then poll ---------------- */
const POLL_CEILING_MS = 15 * 60 * 1000;
const SLIDER_KEYS = { staffing: 'staffing', governance: 'data_governance', risk: 'risk_tolerance', investment: 'upfront_investment' };

/* ---------------- the sample company ----------------
   One cast, shared with QA. These are the values a visitor would TYPE, so the
   demo goes through the same code path as any other intake - the industry
   join, the slider inversion, validation, John's Clause, all of it. There is
   no demo path through the engine.

   The dial numbers are therefore the mirror of canon's, because the track is
   drawn rtl and the submit handler sends `100 - value`: staffing reads 70
   here and arrives at the engine as 30.

   api/qa/harness.mjs rebuilds the payload from these values and fails unless
   it is byte-for-byte the harness's own ordinary-intake fixture, so what the
   demo shows and what QA tests cannot drift apart. */
const DEMO = {
  document: 'editions/sample-harbour-freight.html',
  fields: {
    organization: 'Harbour Freight Lines',
    sector: 'Company',
    industry: 'Regional logistics',
    size: 'About 400',
    regulated: '',
    processes: 'Monthly close, which eats two days. Dispatch scheduling every morning on a whiteboard. Quarterly business reviews that take a week to assemble. RFP responses, two people for a week each time.',
    current_ai: 'Two licences in marketing. A pilot nobody finished. IT has opinions.',
    staffing_text: 'Four analysts, one of whom builds things nobody asked for. Ops lead has been here nineteen years and knows why every exception exists. Cannot hire engineers at our rates.',
    priority: 'Stop losing two days a month to the close.',
  },
  dials: { staffing: 70, governance: 60, risk: 75, investment: 30 },
};

/* Set when the visitor loads the sample, cleared when they clear the form.
   It rides the request, so a document built from invented data is marked as
   one by the record itself and not only by this tab's memory. */
let demo = false;

/* ---------------- what the server says it is doing ----------------
   Keyed to the stages api/lambda/index.mjs writes. Three, because three is
   how many boundaries the engine really has. */
const STAGES = {
  writing: 'Writing your document. This is the long part.',
  checking: 'Checking the draft against the cut line.',
  rewriting: 'The safety check stopped the first draft, so it is being written again. This adds a couple of minutes.',
};

/* ---------------- the reading room ----------------
   Something true to read while the engine works. The cards are static HTML
   for the same reason the engine previews are: a crawler that does not run
   JavaScript should still find the words, and these are some of the clearest
   words on the site. This only moves between them.

   It advances on a timer AND on a click, a swipe or an arrow key, and the
   timer gives up as soon as the visitor steers - nobody wants the page
   moving under their thumb. */
const readingRoom = (() => {
  const room = $('#reading-room');
  const cards = room ? [...room.querySelectorAll('[data-card]')] : [];
  const dots = $('#reading-dots');
  let at = 0, timer = null, steered = false;

  if (dots && cards.length) dots.replaceChildren(...cards.map(() => el('i', {})));

  const show = (i) => {
    at = (i + cards.length) % cards.length;
    cards.forEach((c, n) => { c.hidden = n !== at; });
    if (dots) [...dots.children].forEach((d, n) => d.classList.toggle('on', n === at));
    $('#reading-position')?.replaceChildren(
      document.createTextNode(`Card ${at + 1} of ${cards.length}`));
  };
  const go = (step, byHand) => {
    if (byHand) { steered = true; clearInterval(timer); timer = null; }
    show(at + step);
  };

  if (cards.length) {
    room.querySelector('[data-card-next]')?.addEventListener('click', () => go(1, true));
    room.querySelector('[data-card-prev]')?.addEventListener('click', () => go(-1, true));
    room.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') { e.preventDefault(); go(1, true); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1, true); }
    });
    // a tap on the card itself, and a swipe, both advance
    let x0 = null;
    room.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
    room.addEventListener('pointerup', (e) => {
      if (x0 === null) return;
      const dx = e.clientX - x0; x0 = null;
      if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1, true);
      else if (e.target.closest('[data-card]')) go(1, true);
    });
  }

  return {
    start() {
      if (!cards.length) return;
      steered = false; show(0);
      room.hidden = false;
      clearInterval(timer);
      timer = setInterval(() => { if (!steered) show(at + 1); }, 14000);
    },
    stop() { clearInterval(timer); timer = null; if (room) room.hidden = true; },
  };
})();

/* ---------------- the sample company ----------------
   Fills the instrument in so somebody can see what the thing produces
   without composing four paragraphs about their own employer first. */
const sampleOffer = $('#sample-loaded');
function setDials(values) {
  ranges.forEach((r) => {
    if (values[r.id] !== undefined) r.value = String(values[r.id]);
    describe(r);
  });
}
$('#load-sample')?.addEventListener('click', () => {
  for (const [id, value] of Object.entries(DEMO.fields)) {
    const field = document.getElementById(id);
    if (field) field.value = value;
  }
  setDials(DEMO.dials);
  demo = true;
  if (sampleOffer) sampleOffer.hidden = false;
  $('#sample-offer-line')?.setAttribute('hidden', '');
  $('#form-error').hidden = true;
  /* Send them to the top of the instrument, not to the submit button: the
     four positions are the part worth looking at, and they have just been
     moved. */
  document.getElementById('instrument')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('#sample-doc-link')?.focus();
});
/* Clearing the form is what drops the flag. Editing a field does not: a
   visitor who changes two sentences of the sample and runs it is still
   looking at a document mostly built from data we invented, and it should
   still say so. */
$('#clear-sample')?.addEventListener('click', () => {
  for (const id of Object.keys(DEMO.fields)) {
    const field = document.getElementById(id);
    if (field) field.value = '';
  }
  setDials({ staffing: 50, governance: 50, risk: 50, investment: 50 });
  demo = false;
  if (sampleOffer) sampleOffer.hidden = true;
  $('#sample-offer-line')?.removeAttribute('hidden');
  $('#form-error').hidden = true;
  $('#organization')?.focus();
});

const form = $('#strategy-form');
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const required = [$('#organization'), $('#sector'), $('#processes'), $('#priority')];
  let firstInvalid;
  required.forEach((field) => {
    const invalid = !field.value.trim();
    field.setAttribute('aria-invalid', String(invalid));
    if (invalid) { field.setAttribute('aria-describedby', 'form-error'); firstInvalid ||= field; }
    else field.removeAttribute('aria-describedby');
  });
  if (firstInvalid) {
    $('#form-error').hidden = false;
    $('#form-error').textContent = 'Please complete the organization, the organization type, your processes, and the outcome you want controlled.';
    firstInvalid.focus();
    return;
  }
  $('#form-error').hidden = true;

  if (!KURULTAI_ENDPOINT) {
    $('#form-error').hidden = false;
    $('#form-error').textContent = 'This page has no engine behind it yet. Write to kathleen@prodigalparadigm.com.';
    return;
  }

  const industry = [$('#sector').value, $('#industry').value.trim()].filter(Boolean).join(' - ');
  const body = {
    company: {
      name: $('#organization').value.trim(),
      industry,
      size: $('#size').value.trim(),
      regulated: $('#regulated').value === 'yes',
    },
    processes: $('#processes').value.trim(),
    current_ai: $('#current_ai').value.trim(),
    staffing: $('#staffing_text').value.trim(),
    outcome_90: $('#priority').value.trim(),
    /* The dial is drawn with `direction: rtl`, so 100 sits at the TOP of the
       track, and the sentence at the top of each dial is canon's LEFT pole.
       The engine reads 0 as the left pole. So the number the input carries is
       the mirror of the number the engine needs, and it is inverted here, at
       the single boundary where the page hands over to the API.
       Found by a stress test on 1 Nov 2026: every document before that read
       all four sliders backwards. Do not "simplify" this line. */
    sliders: Object.fromEntries(ranges.map((r) => [SLIDER_KEYS[r.id], 100 - Number(r.value)])),
  };
  /* Not a mode. The engine treats it as any other run; this only travels so
     the finished document can say what it was built from. */
  if (demo) body.demo = true;

  const waiting = $('#council-state');
  $('#council-line').textContent = 'This takes a few minutes. Leave the tab open.';
  $('#brief-result').hidden = true;
  waiting.hidden = false;
  waiting.focus();
  $('#submit-brief').disabled = true;

  const stop = (message) => {
    readingRoom.stop();
    waiting.hidden = true;
    $('#submit-brief').disabled = false;
    $('#form-error').hidden = false;
    $('#form-error').textContent = message;
    $('#form-error').focus?.();
  };

  let id;
  try {
    const r = await fetch(KURULTAI_ENDPOINT, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      /* The server already knows how long the wait is and sends it in
         Retry-After. Saying "shortly" when the real answer is eleven minutes
         just buys a frustrated second attempt. */
      const wait = Number(r.headers.get('retry-after'));
      const mins = Number.isFinite(wait) && wait > 60 ? Math.ceil(wait / 60) : null;
      throw new Error(
        (j.message || 'The council did not sit.')
        + (mins ? ` About ${mins} minute${mins === 1 ? '' : 's'}.` : '')
      );
    }
    id = j.id;
  } catch (err) { stop(err.message); return; }

  /* There used to be five sentences on a timer here - "Sorting your
     processes...", "Writing the ninety days..." - advancing every few
     seconds. They described an order of work that does not exist: the engine
     makes ONE model call that returns the whole document, so there is no
     moment at which it is provably doing the ceremony audit and not the
     staffing map. The page was narrating a process it could not see.
     The wait is filled by the reading room now, which claims nothing about
     progress, and #council-line carries only stages the server actually
     reports. */
  const started = Date.now();
  readingRoom.start();
  const poll = setInterval(async () => {
    /* The ceiling goes FIRST, above every early return. It used to sit inside
       the "still running" branch, below the guard that skips a 429 or a body
       with no status - so a job that died without ever writing a status was
       skipped by that guard on every tick and never reached the ceiling at
       all. The page waited forever. bus #597. */
    if (Date.now() - started > POLL_CEILING_MS) {
      clearInterval(poll);
      stop('This one has been going for fifteen minutes, which means something went wrong rather than slowly. Try again, or write to kathleen@prodigalparadigm.com.');
      return;
    }
    let j, r;
    try {
      r = await fetch(`${KURULTAI_ENDPOINT}?id=${encodeURIComponent(id)}`);
      j = await r.json();
    } catch { return; }                   // a dropped poll is not a failure
    /* Nor is a rate-limited one. The poll bucket can drain while the job is
       still running perfectly well, and a 429 body carries no `status`, so
       the old code fell straight through to the failure message and told the
       user their run had died while the server was still working on it.
       Found by a stress test on 1 Nov 2026. */
    /* 400 and 404 are final: an unknown or expired id never becomes a
       document, and the old loop ignored any body without a status and
       waited forever. */
    if (r.status === 400 || r.status === 404) {
      clearInterval(poll);
      stop(j?.message || 'That document is no longer available. Run it again.');
      return;
    }
    if (r.status === 429 || !j || typeof j.status !== 'string') return;
    if (j.status === 'running') {
      /* Only what the server actually wrote. The engine records three real
         boundaries - the model call, the safety check, and the rewrite that
         a stopped draft triggers - and nothing here invents a fourth. An
         unrecognised stage prints nothing rather than a guess. */
      const said = STAGES[j.stage];
      if (said) $('#council-line').textContent = said;
      return;
    }
    clearInterval(poll);
    readingRoom.stop();
    if (j.status === 'done') {
      waiting.hidden = true;
      renderDocument(j.document, { demo: demo || j.demo === true });
      return;
    }
    const reasons = {
      /* The old wording told the buyer the draft "kept recommending" cuts.
         A grant fund that failed because its own initials matched the guard
         was accused of asking for something it never mentioned. Say what
         actually happened: our check stopped it, and that may be our fault. */
      clause: 'Our safety check stopped this document before it reached you. That check is deliberately blunt and it sometimes stops documents it should not. Please write to kathleen@prodigalparadigm.com - if it misfired she wants to know, and she will send you the document.',
      too_long: 'Your document ran past the length this tier writes in one pass. That is our limit, not a problem with what you typed. Try again, or write to kathleen@prodigalparadigm.com for the full version.',
      refused: 'The engine declined that one. If that looks wrong, write to kathleen@prodigalparadigm.com.',
    };
    stop(reasons[j.reason] || 'That one failed on the way back. Try again, or write to kathleen@prodigalparadigm.com.');
  }, 9000);   // a run takes minutes; polling faster only drains the bucket
});

/* ---------------- the document ---------------- */
const TERMS = {
  myrunbook: "MyRunbook: each person writes down what they actually do all day, in their own words. It is the only way to see which parts of a job hand off and which cannot.",
  mywork: "MyWork: what follows MyRunbook. Having seen the work on a page, the person and their manager decide what the job is now - what it keeps, what it sheds, what it gains.",
};
/* Like strongLine, but the label is a defined term: hover gets the gloss, a
   tap or a keyboard gets the full definition on the homepage. */
const termLine = (label, id, text) => el('p', {}, [
  el('a', { className: 'term', href: `https://thekurultai.com/#${id}`, title: TERMS[id],
            textContent: label }),
  '. ' + String(text ?? ''),
]);

const strongLine = (label, text) => el('p', {}, [el('strong', { textContent: label }), ' ' + String(text ?? '')]);

/* A row the model left entirely blank renders as an empty stripe in a table,
   which reads as a fault in the document rather than in the draft. The
   Harbour Freight sample came back with a fifth people-arc rung whose rung,
   meaning and occupant were all empty strings. Drop rows with nothing in
   them at all; keep partly-filled ones, because a missing cell is itself
   information and the reader should see it. */
const filled = (rows, keys) => (rows || []).filter(
  (r) => keys.some((k) => String(r?.[k] ?? '').trim()));

function table(cols, rows) {
  return el('table', {}, [
    el('thead', {}, el('tr', {}, cols.map((c) => el('th', { scope: 'col', textContent: c })))),
    el('tbody', {}, rows),
  ]);
}
const cell = (text, col) => {
  const td = el('td', { textContent: String(text ?? '') });
  td.setAttribute('data-col', col);
  return td;
};
/* The archetype names are Cherny's, defined in the FAQ. Someone who lands on
   their own document may never have seen the homepage, so the document has to
   carry the definition the way the editions do. The engine constrains the
   field to these five, and anything else falls through as plain text. */
const ARCHETYPES = {
  Prototyper: 'Prototyper: generates brand-new ideas and churns out many concepts quickly, most of which never ship.',
  Builder: 'Builder: takes a prototype or rough idea and rapidly turns it into a production-grade product or infrastructure.',
  Sweeper: 'Sweeper: cleans up the interface, simplifies code and systems, unships failing features and optimizes performance.',
  Grower: 'Grower: takes an existing shipped product and iterates continuously to improve product-market fit.',
  Maintainer: 'Maintainer: owns mature systems and keeps them secure, reliable, fast and efficient as they scale.',
};
const archetypeCell = (text, col) => {
  const name = String(text ?? '').trim();
  if (!ARCHETYPES[name]) return cell(text, col);
  const a = el('a', { className: 'term', href: '#archetypes', textContent: name });
  a.title = ARCHETYPES[name];
  const td = el('td', {}, [el('strong', {}, [a])]);
  td.setAttribute('data-col', col);
  return td;
};
/* The engine constrains `choice` to exactly one of three lowercase tokens.
   Printed raw, the ledger said "mywork" in a table cell on a page that
   defines MyWork as a term and links it to a definition. Anything the engine
   did not constrain falls through unchanged rather than being guessed at. */
const CHOICES = { redeployment: 'Redeployment', mywork: 'MyWork', growth: 'Growth' };

function recBlock(r) {
  const d = el('div', {}, [el('p', { textContent: r.what })]);
  if (r.why) d.append(el('p', { textContent: r.why }));
  d.append(strongLine('Controls:', r.controls));
  if (r.evidence) d.append(strongLine('Evidence:', r.evidence));
  return d;
}
function engine(label, title, kids) {
  return el('div', { className: 'engine-section' }, [
    el('h3', {}, [label, el('br'), title]),
    el('div', {}, kids),
  ]);
}

function renderDocument(d, opts = {}) {
  const isDemo = Boolean(opts.demo);
  /* The pre-rendered sample passes the date it was actually generated. A
     static page that printed new Date() would claim to have been written on
     whatever morning somebody happened to open it. */
  const today = opts.date
    || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const main = $('#main');
  document.body.classList.add('report-page');

  /* The honesty rail. A document built from a company we invented has to say
     so where it cannot be missed or scrolled past, and it has to survive
     print and PDF - somebody will send this to a colleague, and the colleague
     will not have seen the button that made it. So: top of the page, inside
     the printed area, not in the controls strip that print hides. */
  const banner = !isDemo ? null : el('aside', { className: 'demo-banner', role: 'note' }, [
    el('strong', { textContent: 'Built from sample data \u2014 a demonstration, not advice.' }),
    el('p', { textContent: 'Harbour Freight Lines is a company we made up, to show what the instrument returns. Nothing here describes a real organization, and none of it is advice for yours. Put your own work in and the document changes completely.' }),
  ]);

  const controls = el('div', { className: 'report-controls no-print' }, [
    el('p', { textContent: isDemo
      ? 'A QUICK sketch, built from the sample intake and nothing else. Your own document is built the same way, from what you type. The full document is built against your own filings, with every claim sourced.'
      : 'A QUICK sketch, built from what you typed and nothing else. The full document is built against your own filings, with every claim sourced.' }),
    el('div', {}, [
      el('button', { className: 'button', type: 'button', textContent: 'Print or save as PDF', onclick: () => window.print() }),
      /* On the pre-rendered sample there is nothing to start again, so the
         second control goes back to the instrument instead of reloading the
         same fixed document. */
      opts.restartHref
        ? el('a', { className: 'text-button', href: opts.restartHref, textContent: 'Put your own work in' })
        : el('button', { className: 'text-button', type: 'button', textContent: 'Start again', onclick: () => location.reload() }),
    ]),
  ]);

  const doc = el('article', { className: 'document' });
  doc.append(el('header', {}, [
    el('span', {}, ['The Kurultai', el('br'), 'A Prodigal Paradigm product']),
    el('span', {}, [isDemo ? 'QUICK sketch \u00b7 sample data' : 'QUICK sketch', el('br'), today]),
  ]));
  doc.append(el('h1', { textContent: d.title }));
  doc.append(el('p', { className: 'doc-intro', textContent: d.lead }));

  const meta = el('dl', { className: 'doc-meta' });
  const metaRow = (k, v) => meta.append(el('div', {}, [el('dt', { textContent: k }), el('dd', { textContent: v })]));
  metaRow('Prepared from', isDemo
    ? 'A sample company we invented, and its four positions. Not a real organization, and not your data.'
    : 'Your four positions and your own description of the work');
  metaRow('Document status', isDemo
    ? 'A demonstration. The organization does not exist.'
    : 'A sketch. Nothing here has been checked against your filings.');
  /* `stage` is meant to be a short label. If the model writes a sentence
     instead, print it as it stands rather than wrapping it in a phrase that
     turns it into nonsense. */
  const stage = (d.staffing_map?.stage || '').trim();
  metaRow('Scope', !stage ? 'As described in the brief'
    /* Not lowercased. The model writes stages like "strong-PMF", and forcing
       the case turned that into "strong-pmf" in the one place a reader meets
       it first. */
    : stage.length <= 28 ? `An organization at the ${stage} stage`
    : stage);
  metaRow('Evidence status', isDemo
    ? 'None, and none is possible. The sample company has no filings because it has no existence.'
    : 'Self-reported. No outside research was performed.');
  doc.append(meta);

  /* How the four placements read back. */
  const stance = el('section', { className: 'doc-section' }, el('h2', { textContent: 'Where you put yourself' }));
  const labels = { staffing: 'Staffing', data_governance: 'Data governance', risk_tolerance: 'Risk aversion', upfront_investment: 'Upfront investment' };
  for (const [k, label] of Object.entries(labels))
    if (d.reading?.[k]) stance.append(strongLine(label + '.', d.reading[k]));
  doc.append(stance);

  if (d.capacity_statement)
    doc.append(el('section', { className: 'doc-section recommendation' }, [
      el('h2', { textContent: d.layoff_request_detected ? 'A note on what you asked for' : 'What the work frees up' }),
      el('p', { textContent: d.capacity_statement }),
      strongLine('Non-negotiable:', 'this is not a workforce-reduction plan. No slider setting changes that principle.'),
    ]));

  /* The four engines. */
  const group = el('section', { className: 'doc-section engine-group' }, [
    el('h2', { textContent: 'The four engines' }),
    el('p', { textContent: d.ceremony_audit?.note || '' }),
  ]);

  group.append(engine('Engine one', 'The ceremony audit', [
    table(['Process', 'Reading', 'What follows'], filled(d.ceremony_audit?.rows, ['process', 'classification', 'why', 'recommendation']).map((r) => {
      const reading = el('td');
      reading.setAttribute('data-col', 'Reading');
      reading.append(el('strong', { textContent: r.classification }), el('br'), String(r.why ?? ''));
      const follows = el('td');
      follows.setAttribute('data-col', 'What follows');
      /* recBlock is shaped for the 30/60/90 rows ({what, why, controls,
         evidence}). A ceremony row's recommendation is a STRING, and its
         controls sit beside it on the row - so passing the string here
         printed an empty paragraph and a bare "Controls:" label, and
         dropped both the recommendation and the acceptance evidence. */
      if (r.recommendation) follows.append(el('p', { textContent: r.recommendation }));
      if (r.controls) follows.append(strongLine('Controls:', r.controls));
      if (r.management_conversation) follows.append(strongLine('For the management conversation:', r.management_conversation));
      return el('tr', {}, [cell(r.process, 'Process'), reading, follows]);
    })),
  ]));

  group.append(engine('Engine two', 'The decision ledger', [
    el('p', { textContent: d.decision_ledger?.note || '' }),
    table(['Capacity freed', 'The decision', 'Lands in', 'Owned by', 'By when'],
      filled(d.decision_ledger?.rows, ['freed_capacity', 'decision', 'choice', 'assigned_role', 'by_when']).map((r) => el('tr', {}, [
        cell(r.freed_capacity, 'Capacity freed'), cell(r.decision, 'The decision'),
        cell(CHOICES[String(r.choice ?? '').trim()] ?? r.choice, 'Lands in'), cell(r.assigned_role, 'Owned by'), cell(r.by_when, 'By when'),
      ]))),
    el('p', { className: 'small', textContent: 'This table is meant to be signed. A row with no owner is not a decision, it is a hope.' }),
  ]));

  group.append(engine('Engine three', 'The people arc', [
    /* The two house terms, linked to their definition. A reader of a
       generated document may never have seen the homepage, and these are
       the only two words in it we invented. */
    termLine('MyRunbook', 'myrunbook', d.people_arc?.runbook),
    termLine('MyWork', 'mywork', d.people_arc?.mywork),
    table(['Rung', 'What it means here', 'Who is standing on it'],
      filled(d.people_arc?.ladder, ['rung', 'means', 'who']).map((r) => el('tr', {}, [
        cell(r.rung, 'Rung'), cell(r.means, 'What it means here'), cell(r.who, 'Who is standing on it'),
      ]))),
    d.people_arc?.note ? el('p', { textContent: d.people_arc.note }) : null,
  ]));

  const hiring = el('p', { className: 'small' }, [
    'When the hiring starts, the conversation is the hard part. ',
    el('a', { href: 'https://rippertherecruiter.com/', textContent: 'Ripper the Recruiter' }),
    ' sits in on the screening call and deals the next three questions as each answer lands. Free, no account.',
  ]);
  group.append(engine('Engine four', 'The staffing map', [
    strongLine('Stage.', d.staffing_map?.stage),
    table(['Archetype', 'What you need it for', 'Where it comes from', 'Why'],
      filled(d.staffing_map?.mix, ['archetype', 'need', 'source', 'why']).map((r) => el('tr', {}, [
        archetypeCell(r.archetype, 'Archetype'), cell(r.need, 'What you need it for'),
        cell(r.source, 'Where it comes from'), cell(r.why, 'Why'),
      ]))),
    d.staffing_map?.hiring_note ? el('p', { textContent: d.staffing_map.hiring_note }) : null,
    hiring,
  ]));
  doc.append(group);

  /* Ninety days. */
  const plan = el('section', { className: 'doc-section' }, el('h2', { textContent: 'The ninety days' }));
  for (const [k, title] of [['d30', 'By day 30'], ['d60', 'By day 60'], ['d90', 'By day 90']]) {
    const rows = filled(d.plan?.[k], ['what', 'why', 'controls', 'evidence']);
    if (!rows.length) continue;
    plan.append(el('div', { className: 'engine-section' }, [
      el('h3', { textContent: title }),
      el('div', {}, rows.map(recBlock)),
    ]));
  }
  doc.append(plan);

  /* Governance starter. */
  const gov = el('section', { className: 'doc-section' }, el('h2', { textContent: 'The governance starter' }));
  const list = (title, items) => {
    if (!items?.length) return;
    gov.append(el('h3', { textContent: title }));
    gov.append(el('ul', {}, items.map((t) => el('li', { textContent: t }))));
  };
  list('Acceptable use, in skeleton', d.governance?.aup);
  list('Where a human stays in the loop, by default', d.governance?.hitl_defaults);
  if (d.governance?.kill_switch) gov.append(strongLine('Kill switch.', d.governance.kill_switch));
  if (d.governance?.stage_gate) gov.append(strongLine('Stage gate.', d.governance.stage_gate));
  gov.append(el('p', { className: 'citation-example' }, [
    /* This used to read "The staged pattern that describes is a working one",
       which has no subject - it was written to trail the stage-gate line and
       lost its antecedent. The stage-gate line is conditional, so the
       replacement stands on its own rather than pointing at a neighbour. */
    'Observe, then suggest, then act, with promotion between stages a configuration change a named reviewer approves: that is a working pattern, not a diagram. ',
    el('a', { href: 'https://github.com/prodigalparadigm/stagegate', textContent: 'stagegate' }),
    ' is the implementation, with a hash-chained audit log and the kill switch wired in.',
  ]));
  doc.append(gov);

  if ((d.open_questions || []).length)
    doc.append(el('section', { className: 'doc-section' }, [
      el('h2', { textContent: 'What this document does not know' }),
      el('ul', {}, d.open_questions.map((t) => el('li', { textContent: t }))),
    ]));

  doc.append(el('section', { className: 'doc-section recommendation' }, [
    el('h2', { textContent: 'The bar' }),
    el('p', { textContent: 'Every recommendation above names the future outcome it controls. Judged only by whether it controls a future outcome - that is the test this document put your processes through, so it is the test to put this document through.' }),
    el('p', { className: 'small', textContent: 'The Kurultai does not produce headcount-reduction recommendations, ever. What the work frees up is a decision, and the ledger says whose.' }),
  ]));

  doc.append(el('div', { className: 'doc-foot' }, [
    el('span', { textContent: 'The Kurultai · thekurultai.com' }),
    el('span', { textContent: (isDemo ? 'QUICK sketch · sample data · ' : 'QUICK sketch · ') + today }),
  ]));

  main.replaceChildren(...[banner, controls, doc].filter(Boolean));
  main.setAttribute('tabindex', '-1');
  main.focus();
  window.scrollTo(0, 0);
}

/* ---------------- odds and ends from the concept ---------------- */
const dialog = $('#advisory-dialog');
$('#advisory-button')?.addEventListener('click', () => dialog.showModal());
dialog?.querySelectorAll('.dialog-close').forEach((b) => b.addEventListener('click', () => dialog.close()));
$('#print-report')?.addEventListener('click', () => window.print());
if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
    if (entry.isIntersecting) { entry.target.classList.add('reveal'); observer.unobserve(entry.target); }
  }), { threshold: .1 });
  document.querySelectorAll('.hero-premise,.hero-lede h1,.standfirst,.section-intro h2,.section-intro p,.showcase h2,.report-stage,.patron-teaser figure,.patron-teaser h2,.footer-thesis')
    .forEach((e) => observer.observe(e));
}
