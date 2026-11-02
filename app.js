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
const SLIDER_KEYS = { staffing: 'staffing', governance: 'data_governance', risk: 'risk_tolerance', investment: 'upfront_investment' };

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

  const waiting = $('#council-state');
  $('#council-line').textContent = 'Sorting your processes into ceremonial and instrumental.';
  $('#brief-result').hidden = true;
  waiting.hidden = false;
  waiting.focus();
  $('#submit-brief').disabled = true;

  const stop = (message) => {
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

  /* Say something true about the wait rather than spinning silently. Polling
     costs no model tokens, so it never touches the daily spend cap. */
  const lines = [
    'Sorting your processes into ceremonial and instrumental.',
    'Working out where the freed capacity lands, and who decides.',
    'Reading your staffing against the five archetypes.',
    'Writing the ninety days.',
    'Still working. A long document takes a few minutes.',
  ];
  let tick = 0;
  const started = Date.now();
  const poll = setInterval(async () => {
    const mins = Math.floor((Date.now() - started) / 60000);
    $('#council-line').textContent = lines[Math.min(tick++, lines.length - 1)]
      + (mins >= 3 ? ' Still going; a long one.' : '');
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
      /* And an overall ceiling, for a job that dies without writing a status
         at all - a timeout or an out-of-memory kill. */
      if (Date.now() - started > 15 * 60 * 1000) {
        clearInterval(poll);
        stop('This one has been going for fifteen minutes, which means something went wrong rather than slowly. Try again, or write to kathleen@prodigalparadigm.com.');
      }
      return;
    }
    clearInterval(poll);
    if (j.status === 'done') { waiting.hidden = true; renderDocument(j.document); return; }
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
const el = (tag, props = {}, kids = []) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of [].concat(kids)) if (k !== null && k !== undefined) n.append(k);
  return n;
};
const strongLine = (label, text) => el('p', {}, [el('strong', { textContent: label }), ' ' + String(text ?? '')]);

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

function renderDocument(d) {
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const main = $('#main');
  document.body.classList.add('report-page');

  const controls = el('div', { className: 'report-controls no-print' }, [
    el('p', { textContent: 'A QUICK sketch, built from what you typed and nothing else. The full document is built against your own filings, with every claim sourced.' }),
    el('div', {}, [
      el('button', { className: 'button', type: 'button', textContent: 'Print or save as PDF', onclick: () => window.print() }),
      el('button', { className: 'text-button', type: 'button', textContent: 'Start again', onclick: () => location.reload() }),
    ]),
  ]);

  const doc = el('article', { className: 'document' });
  doc.append(el('header', {}, [
    el('span', {}, ['The Kurultai', el('br'), 'A Prodigal Paradigm product']),
    el('span', {}, ['QUICK sketch', el('br'), today]),
  ]));
  doc.append(el('h1', { textContent: d.title }));
  doc.append(el('p', { className: 'doc-intro', textContent: d.lead }));

  const meta = el('dl', { className: 'doc-meta' });
  const metaRow = (k, v) => meta.append(el('div', {}, [el('dt', { textContent: k }), el('dd', { textContent: v })]));
  metaRow('Prepared from', 'Your four positions and your own description of the work');
  metaRow('Document status', 'A sketch. Nothing here has been checked against your filings.');
  /* `stage` is meant to be a short label. If the model writes a sentence
     instead, print it as it stands rather than wrapping it in a phrase that
     turns it into nonsense. */
  const stage = (d.staffing_map?.stage || '').trim();
  metaRow('Scope', !stage ? 'As described in the brief'
    : stage.length <= 28 ? `An organization at the ${stage.toLowerCase()} stage`
    : stage);
  metaRow('Evidence status', 'Self-reported. No outside research was performed.');
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
    table(['Process', 'Reading', 'What follows'], (d.ceremony_audit?.rows || []).map((r) => {
      const reading = el('td');
      reading.setAttribute('data-col', 'Reading');
      reading.append(el('strong', { textContent: r.classification }), el('br'), String(r.why ?? ''));
      const follows = el('td');
      follows.setAttribute('data-col', 'What follows');
      if (r.recommendation) follows.append(recBlock(r.recommendation));
      if (r.management_conversation) follows.append(strongLine('For the management conversation:', r.management_conversation));
      return el('tr', {}, [cell(r.process, 'Process'), reading, follows]);
    })),
  ]));

  group.append(engine('Engine two', 'The decision ledger', [
    el('p', { textContent: d.decision_ledger?.note || '' }),
    table(['Capacity freed', 'The decision', 'Lands in', 'Owned by', 'By when'],
      (d.decision_ledger?.rows || []).map((r) => el('tr', {}, [
        cell(r.freed_capacity, 'Capacity freed'), cell(r.decision, 'The decision'),
        cell(r.choice, 'Lands in'), cell(r.assigned_role, 'Owned by'), cell(r.by_when, 'By when'),
      ]))),
    el('p', { className: 'small', textContent: 'This table is meant to be signed. A row with no owner is not a decision, it is a hope.' }),
  ]));

  group.append(engine('Engine three', 'The people arc', [
    strongLine('MyRunbook.', d.people_arc?.runbook),
    strongLine('MyWork.', d.people_arc?.mywork),
    table(['Rung', 'What it means here', 'Who is standing on it'],
      (d.people_arc?.ladder || []).map((r) => el('tr', {}, [
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
      (d.staffing_map?.mix || []).map((r) => el('tr', {}, [
        cell(r.archetype, 'Archetype'), cell(r.need, 'What you need it for'),
        cell(r.source, 'Where it comes from'), cell(r.why, 'Why'),
      ]))),
    d.staffing_map?.hiring_note ? el('p', { textContent: d.staffing_map.hiring_note }) : null,
    hiring,
  ]));
  doc.append(group);

  /* Ninety days. */
  const plan = el('section', { className: 'doc-section' }, el('h2', { textContent: 'The ninety days' }));
  for (const [k, title] of [['d30', 'By day 30'], ['d60', 'By day 60'], ['d90', 'By day 90']]) {
    const rows = d.plan?.[k] || [];
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
    'The staged pattern that describes is a working one, not a diagram: observe, then suggest, then act, with promotion between stages a config change a named reviewer approves. ',
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
    el('span', { textContent: 'QUICK sketch · ' + today }),
  ]));

  main.replaceChildren(controls, doc);
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
  document.querySelectorAll('.hero-premise,.hero-paper,.hero-bottom h1,.standfirst,.section-intro h2,.section-intro p,.showcase h2,.report-stage,.patron-teaser figure,.patron-teaser h2,.footer-thesis')
    .forEach((e) => observer.observe(e));
}
