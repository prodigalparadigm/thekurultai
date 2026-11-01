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

/* ---------------- what the four engines are ----------------
   Authored copy, not model output, so innerHTML is safe here. */
const previews = {
  ceremony: `<p class="report-tag">The Kurultai · Engine one</p><h3>The ceremony audit.</h3><p class="report-lede">Point an instrumental tool at a ceremonial process and the process absorbs it and produces more ceremony, faster.</p><h4>What it does</h4><p>Every process you describe is sorted into two piles. Instrumental: it is judged by whether it controls a future outcome. Ceremonial: it runs on precedent, or it displays status.</p><h4>The rule</h4><p>Recommendations attach only to the first pile. The second pile is named for the management conversation it deserves, with no tooling recommendation attached to it.</p><div class="report-bottom">Veblen · Instrumental vs ceremonial</div>`,
  ledger: `<p class="report-tag">The Kurultai · Engine two</p><h3>The decision ledger.</h3><p class="report-lede">Freed time stays free only by explicit management decision.</p><h4>Why it exists</h4><p>The washing machine gave households back hours and the hours went straight back into the same work, because nobody decided otherwise. The same thing is happening now, faster.</p><h4>What it produces</h4><table><caption class="small">One row per decision</caption><thead><tr><th scope="col">Capacity freed</th><th scope="col">Owned by</th><th scope="col">By when</th></tr></thead><tbody><tr><td>What the work gives back</td><td>A named role</td><td>A date</td></tr></tbody></table><p>A row with no owner is not a decision, it is a hope. The table is meant to be signed.</p><div class="report-bottom">Redeployment · MyWork · Growth</div>`,
  people: `<p class="report-tag">The Kurultai · Engine three</p><h3>The people arc.</h3><p class="report-lede">The piece nobody is selling.</p><h4>MyRunbook</h4><p>Each person documents what they actually do all day. It is the only way to see what hands off and what cannot, and it is the thing that stops domain knowledge walking out of the building unrecorded.</p><h4>MyWork</h4><p>Having seen it, work out what the job is now. Then the ladder: equipped, oriented, builder, ready to write code with an agent. That is what engaged has to mean if it is going to mean anything.</p><div class="report-bottom">Trained incapacity · The adoption ladder</div>`,
  staffing: `<p class="report-tag">The Kurultai · Engine four</p><h3>The staffing map.</h3><p class="report-lede">Five archetypes, mixed for the stage you are actually at.</p><h4>The mix</h4><p>Prototyper, builder, sweeper, grower, maintainer. Before product-market fit the weight sits on the first three; growing, it moves to the middle; once the thing is working, to the last three.</p><h4>What you get</h4><p>Which archetypes are already in the building, which you would be hiring or partnering for, and the hiring conversation named where hiring actually enters.</p><div class="report-bottom">Cherny · In-house vs to-hire</div>`,
};
document.querySelectorAll('[data-preview]').forEach((btn) => btn.addEventListener('click', () => {
  document.querySelectorAll('[data-preview]').forEach((other) => {
    other.classList.toggle('selected', other === btn);
    other.setAttribute('aria-pressed', String(other === btn));
  });
  $('#report-preview').innerHTML = previews[btn.dataset.preview];
}));
if ($('#report-preview')) $('#report-preview').innerHTML = previews.ceremony;

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
    sliders: Object.fromEntries(ranges.map((r) => [SLIDER_KEYS[r.id], Number(r.value)])),
  };

  const waiting = $('#council-state');
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
    if (!r.ok) throw new Error(j.message || 'The council did not sit. Try again shortly.');
    id = j.id;
  } catch (err) { stop(err.message); return; }

  /* Say something true about the wait rather than spinning silently. Polling
     costs no model tokens, so it never touches the daily spend cap. */
  const lines = [
    'Sorting your processes into ceremonial and instrumental.',
    'Working out where the freed capacity lands, and who decides.',
    'Reading your staffing against the five archetypes.',
    'Writing the ninety days.',
    'Checking the document against its own acceptance bar.',
  ];
  let tick = 0;
  const started = Date.now();
  const poll = setInterval(async () => {
    const mins = Math.floor((Date.now() - started) / 60000);
    $('#council-line').textContent = lines[Math.min(tick++ >> 1, lines.length - 1)]
      + (mins >= 3 ? ' Still going; a long one.' : '');
    let j;
    try {
      const r = await fetch(`${KURULTAI_ENDPOINT}?id=${encodeURIComponent(id)}`);
      j = await r.json();
    } catch { return; }                   // a dropped poll is not a failure
    if (j.status === 'running') return;
    clearInterval(poll);
    if (j.status === 'done') { waiting.hidden = true; renderDocument(j.document); return; }
    stop(j.reason === 'clause'
      ? 'The draft kept recommending something this product does not recommend, so it was not shipped. That is the rail doing its job. Write to kathleen@prodigalparadigm.com and she will look at it.'
      : 'That one failed on the way back. Try again, or write to kathleen@prodigalparadigm.com.');
  }, 4000);
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
  const labels = { staffing: 'Staffing', data_governance: 'Data governance', risk_tolerance: 'Risk tolerance', upfront_investment: 'Upfront investment' };
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
