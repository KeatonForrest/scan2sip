// UI state is explicitly correlated: every selection change, scan start,
// non-match, failure, and reset clears or replaces the previous wine, and
// a monotonically increasing generation token makes late responses for a
// superseded selection/request harmless. Replay is always bound to the
// original fixture + request_id, never to the current selection.

let scenarios = [];
let selected = null;
let lastScan = null; // { fixture_id, request_id }
let generation = 0;

const $ = (id) => document.getElementById(id);

const OUTCOME_COPY = {
  matched: (r) => ['Exact catalog match', 'This identity matched one catalog wine exactly. Each fact below keeps its own evidence status — a match does not upgrade an AI-generated fixture note.'],
  provisional: () => ['Uncertain — needs identity review', 'The observation is too uncertain to match, even if a similar wine exists. Nothing was published; a local research demand may have been recorded.'],
  ambiguous: () => ['Ambiguous identity', 'More than one exact candidate exists, so none was chosen. Nothing was published.'],
  not_wine: () => ['Not a wine bottle', 'No identity was recorded and nothing was published.'],
  failed: (r) => ['Scan failed', `Simulated provider failure (${r.reason}). No fallback result was substituted and nothing was published.`],
  missing_vintage_mismatch: () => ['No match — different vintage', 'The producer and bottling are known, but this vintage is not in the catalog. A different year was not substituted.'],
  missing_vintage_required: () => ['No match — vintage unknown', 'The vintage could not be read, and an unknown vintage never matches a year-specific record. It is not treated as NV.'],
  missing_unknown_wine: () => ['No match — unknown wine', 'This wine is not in the catalog. Nothing was published; a local research demand may have been recorded.'],
};

function clearOutcome(title = 'Pick a sample, then scan.', text = 'The result will say plainly whether the bottle matched the catalog, and what — if anything — was recorded.') {
  $('outcomeChip').textContent = 'Ready';
  $('outcomeChip').className = 'chip chip-idle';
  $('outcomeTitle').textContent = title;
  $('outcomeText').textContent = text;
  $('wineFacts').innerHTML = '';
}

function selectScenario(scenario, { fromSample = false } = {}) {
  generation += 1;
  selected = scenario;
  // Selection clears the visible result/wine, but replay stays bound to
  // the original fixture + request_id (buttons reflect lastScan, not the
  // current selection).
  $('replayBtn').disabled = !lastScan;
  $('rescanBtn').disabled = !lastScan;
  document.querySelectorAll('.sample').forEach((b) =>
    b.classList.toggle('sel', b.dataset.fixture === scenario.fixture_id));
  document.querySelectorAll('.card').forEach((c) =>
    c.classList.toggle('sel', c.dataset.fixture === scenario.fixture_id));
  if (!fromSample) {
    // Keep the primary samples in sync when chosen from the inspector.
    document.querySelectorAll('.sample').forEach((b) =>
      b.classList.toggle('sel', b.dataset.fixture === scenario.fixture_id));
  }
  $('bottleLabel').setAttribute('href', `/fixtures/${scenario.label}`);
  $('bottleCaption').textContent = `${scenario.title} (synthetic)`;
  clearOutcome('Ready to scan.', 'Press “Scan this bottle”. The previous result has been cleared.');
  $('result').textContent = 'Nothing scanned yet.';
}

async function runScan(fixtureId, requestId) {
  const token = ++generation;
  clearOutcome('Scanning (simulated)…', 'The authored fixture response is being matched locally.');
  $('outcomeChip').textContent = 'Working';
  let body;
  try {
    const res = await fetch('/api/scans', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fixture_id: fixtureId, request_id: requestId }),
    });
    body = await res.json();
    if (!res.ok) throw Object.assign(new Error(body.error ?? 'scan_failed'), { body });
  } catch (e) {
    if (token !== generation) return;
    clearOutcome('Request failed', `The scan request could not be completed (${e.message}). No result was substituted.`);
    $('outcomeChip').textContent = 'Failed';
    $('outcomeChip').className = 'chip chip-failed';
    $('result').textContent = JSON.stringify(e.body ?? { error: e.message }, null, 2);
    return;
  }
  if (token !== generation) return; // Late response for a superseded state.

  lastScan = { fixture_id: fixtureId, request_id: requestId };
  $('replayBtn').disabled = false;
  $('rescanBtn').disabled = false;
  $('result').textContent = JSON.stringify(body, null, 2);

  const key = body.status === 'missing' ? `missing_${body.reason}` : body.status;
  const [title, text] = (OUTCOME_COPY[key] ?? OUTCOME_COPY[body.status] ?? (() => ['Result', '']))(body);
  $('outcomeTitle').textContent = body.replayed ? `${title} (replayed — no new record)` : title;
  const replayNote = body.replayed && selected && fixtureId !== selected.fixture_id
    ? ' This replay shows the original scanned bottle, not the currently selected label.' : '';
  $('outcomeText').textContent = text + replayNote;
  $('outcomeChip').textContent = body.status + (body.reason ? ` · ${body.reason}` : '');
  $('outcomeChip').className = `chip chip-${body.status}`;

  if (body.status === 'matched' && body.wine_id) {
    await showWine(body.wine_id, token);
  } else {
    $('wineFacts').innerHTML = '<p class="nofacts">No catalog facts are shown for this result.</p>';
  }
  await refreshDemands();
}

async function showWine(id, token) {
  const { wine } = await (await fetch(`/api/wines/${id}`)).json();
  if (token !== generation) return;
  const vintage = wine.vintage ?? 'vintage unknown';
  $('wineFacts').innerHTML = `<h3>${wine.producer} · ${wine.name} · ${vintage}</h3>` +
    Object.entries(wine.fields).map(([field, f]) => `
      <div class="field"><span class="fname">${field}</span>
      <span>${f.value ?? '<span class="unknown">Unknown</span>'}</span>
      <span class="status ${f.status === 'unknown' ? 'warn' : ''}">${f.status}</span>
      ${f.quote ? `<blockquote>“${f.quote}” <small>${f.source_id}</small></blockquote>` : ''}
      </div>`).join('');
}

async function refreshDemands() {
  const { demands } = await (await fetch('/api/demands')).json();
  $('demands').textContent = demands.length
    ? demands.map((d) => `${d.producer} · ${d.name} · ${d.vintage ?? 'vintage unknown'} (${d.utc_day})`).join('\n')
    : 'None.';
}

async function load() {
  const data = await (await fetch('/api/fixtures')).json();
  scenarios = data.scenarios;
  $('scenarios').innerHTML = scenarios.map((s) => `
    <button class="card" data-fixture="${s.fixture_id}">
      <img src="/fixtures/${s.label}" alt="Synthetic label: ${s.title}">
      <span>${s.title}</span><small>${s.expect}</small>
    </button>`).join('');
  document.querySelectorAll('.card').forEach((el) =>
    el.addEventListener('click', () => selectScenario(scenarios.find((s) => s.fixture_id === el.dataset.fixture))));
  document.querySelectorAll('.sample').forEach((el) =>
    el.addEventListener('click', () => selectScenario(scenarios.find((s) => s.fixture_id === el.dataset.fixture), { fromSample: true })));
  const first = scenarios.find((s) => s.fixture_id === 'scan-orchard-2021');
  if (first) selectScenario(first, { fromSample: true });
  await refreshDemands();
}

$('scanBtn').addEventListener('click', () => {
  if (!selected) return;
  runScan(selected.fixture_id, `req-${Date.now()}`);
});
$('replayBtn').addEventListener('click', () => {
  if (lastScan) runScan(lastScan.fixture_id, lastScan.request_id);
});
$('rescanBtn').addEventListener('click', () => {
  if (lastScan) runScan(lastScan.fixture_id, `req-${Date.now()}-rescan`);
});
$('resetBtn').addEventListener('click', async () => {
  generation += 1;
  await fetch('/api/reset', { method: 'POST' });
  lastScan = null;
  $('replayBtn').disabled = true;
  $('rescanBtn').disabled = true;
  clearOutcome('Workspace reset.', 'All observations and demand were cleared; the catalog was reseeded.');
  $('result').textContent = 'Nothing scanned yet.';
  await refreshDemands();
});

load();
