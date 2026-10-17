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
  $('resetError').hidden = true;
  $('resetError').textContent = '';
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
  askWineId = null;
  chatGeneration += 1;
  $('askWineLabel').textContent = 'Match or publish a wine first.';
  $('askAnswer').textContent = 'No question asked yet.';
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
    setAskWine(body.wine_id);
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

// ---- Milestone 2: evidence flow, ask-this-wine, region explorer ----
let selectedDocument = null;
let stagedArtifact = null;
let importedReview = null;
let askWineId = null;
let chatGeneration = 0;
let evidenceGeneration = 0;
let explorerGeneration = 0;

function setAskWine(wineId) {
  askWineId = wineId;
  chatGeneration += 1;
  $('askAnswer').textContent = 'Ask a question about this wine.';
  fetch(`/api/wines/${wineId}`).then((r) => r.json()).then(({ wine }) => {
    if (askWineId !== wineId) return;
    $('askWineLabel').textContent = `Asking about: ${wine.producer} · ${wine.name} · ${wine.vintage ?? 'vintage unknown'} (revision ${wine.revision}) — simulated fixture answers.`;
  }).catch(() => {});
}

async function loadDocuments() {
  const { documents, demo_clock } = await (await fetch('/api/documents')).json();
  $('demoClock').textContent = demo_clock;
  $('documents').innerHTML = documents.map((d) => `
    <div class="card doc-card" data-doc="${d.document_id}">
      <button class="doc-select">${d.identity.producer} · ${d.identity.name} · ${d.identity.vintage ?? 'vintage unknown'}</button>
      <small>${d.document}</small>
      <a href="/fixtures/${d.document}" target="_blank" rel="noopener">View source sheet (local)</a>
    </div>`).join('');
  document.querySelectorAll('.doc-card .doc-select').forEach((el) => el.addEventListener('click', () => {
    const card = el.closest('.doc-card');
    evidenceGeneration += 1;
    selectedDocument = card.dataset.doc;
    stagedArtifact = null; importedReview = null;
    document.querySelectorAll('.doc-card').forEach((c) => c.classList.toggle('sel', c === card));
    $('stageBtn').disabled = false;
    $('playbackReviewBtn').disabled = true;
    $('publishBtn').disabled = true;
    $('artifactView').textContent = 'Document selected. Stage it to validate its quoted evidence.';
  }));
}

$('stageBtn').addEventListener('click', async () => {
  const token = ++evidenceGeneration;
  const documentId = selectedDocument;
  const res = await fetch('/api/documents', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ document_id: documentId, request_id: `stage-${Date.now()}` }),
  });
  const artifact = await res.json();
  if (token !== evidenceGeneration || selectedDocument !== documentId) return; // superseded selection
  if (!res.ok) { $('artifactView').textContent = `Staging failed: ${artifact.error}`; return; }
  stagedArtifact = artifact;
  $('playbackReviewBtn').disabled = artifact.status === 'held';
  $('artifactView').innerHTML = `<h3>${artifact.identity.producer} · ${artifact.identity.name} · ${artifact.identity.vintage ?? 'vintage unknown'}</h3>
    <p>Status: <strong>${artifact.status}</strong>${artifact.reason ? ` (${artifact.reason})` : ''} · artifact <code>${artifact.artifact_sha256.slice(0, 12)}…</code></p>` +
    artifact.fields.map((f) => `<div class="field"><span class="fname">${f.field}</span><span>${f.value ?? '<span class="unknown">Unknown</span>'}</span><span class="status ${f.support === 'supported' ? '' : 'warn'}">${f.support}</span>${f.quotes?.map((q) => `<blockquote>“${q.quote}”</blockquote>`).join('') ?? ''}</div>`).join('');
});

$('playbackReviewBtn').addEventListener('click', async () => {
  const token = ++evidenceGeneration;
  const artifactId = stagedArtifact.artifact_id;
  const res = await fetch(`/api/artifacts/${artifactId}/review`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ source: 'playback_example' }),
  });
  const review = await res.json();
  if (token !== evidenceGeneration || stagedArtifact?.artifact_id !== artifactId) return;
  if (!res.ok) { $('artifactView').insertAdjacentHTML('beforeend', `<p class="unknown">Review failed: ${review.error}</p>`); return; }
  importedReview = review;
  $('publishBtn').disabled = false;
  $('artifactView').insertAdjacentHTML('beforeend', `<p>Simulated review playback imported (classification: <strong>${review.classification}</strong> — not independently reviewed). Accepted: ${review.accepted_fields.join(', ')}. Plan <code>${review.plan_digest.slice(0, 12)}…</code></p>`);
});

$('publishBtn').addEventListener('click', async () => {
  const token = ++evidenceGeneration;
  const artifactId = stagedArtifact.artifact_id;
  const res = await fetch('/api/publications', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ artifact_id: artifactId, request_id: `pub-${Date.now()}`, review_digest: importedReview?.review_digest }),
  });
  const result = await res.json();
  if (token !== evidenceGeneration || stagedArtifact?.artifact_id !== artifactId) return;
  if (!res.ok) { $('artifactView').insertAdjacentHTML('beforeend', `<p class="unknown">Publication failed: ${result.error}</p>`); return; }
  $('artifactView').insertAdjacentHTML('beforeend', `<p>Publication: <strong>${result.status}</strong> → wine <code>${result.wine_id}</code> revision ${result.revision} (review classification: ${importedReview?.classification}). Rescan the bottle above to see it match, then ask it a question.</p>`);
  if (result.wine_id) setAskWine(result.wine_id);
  await loadRegions();
});

document.querySelectorAll('.ask-q').forEach((btn) => btn.addEventListener('click', async () => {
  if (!askWineId) { $('askAnswer').textContent = 'Match or publish a wine first.'; return; }
  const token = ++chatGeneration;
  const wineId = askWineId;
  const res = await fetch('/api/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wine_id: wineId, question: btn.dataset.q, request_id: `chat-${Date.now()}` }),
  });
  const body = await res.json();
  if (token !== chatGeneration || askWineId !== wineId) return; // never show another wine's answer
  $('askAnswer').innerHTML = res.ok
    ? `<p>${body.answer}</p>${body.citations.map((c) => `<blockquote>“${c.quote}” <small>${c.field} · ${c.status} · review: ${c.review_classification ?? 'n/a'} · ${c.source_id}</small></blockquote>`).join('')}<p class="muted">Simulated fixture answer · revision ${body.revision} · provider latency N/A</p>`
    : `<p class="unknown">Chat failed: ${body.error}</p>`;
}));

async function loadRegions() {
  const { regions } = await (await fetch('/api/regions')).json();
  const byRegion = Object.fromEntries(regions.map((r) => [r.region, r.wines]));
  const renderChips = (region) => {
    const wines = byRegion[region] ?? [];
    $('regionChips').innerHTML = wines.length
      ? wines.map((w) => `<button class="chip-btn" data-wine="${w.wine_id}">${w.producer} · ${w.name} · ${w.vintage ?? 'vintage unknown'}</button>`).join('')
      : '<span class="muted">No wines in this region yet.</span>';
    document.querySelectorAll('#regionChips .chip-btn').forEach((chip) => chip.addEventListener('click', async () => {
      document.querySelectorAll('#regionChips .chip-btn').forEach((c) => c.classList.toggle('sel', c === chip));
      const token = ++explorerGeneration;
      const { wine } = await (await fetch(`/api/wines/${chip.dataset.wine}`)).json();
      if (token !== explorerGeneration) return; // a newer selection owns the panel
      $('explorerDetails').innerHTML = `<h3>${wine.producer} · ${wine.name} · ${wine.vintage ?? 'vintage unknown'}</h3>` +
        Object.entries(wine.fields).map(([field, f]) => `<div class="field"><span class="fname">${field}</span><span>${f.value ?? '<span class="unknown">Unknown</span>'}</span><span class="status ${f.status === 'unknown' ? 'warn' : ''}">${f.status}</span>${f.review_classification ? `<span class="status">review: ${f.review_classification}</span>` : ''}</div>`).join('');
    }));
  };
  document.querySelectorAll('.region-map path').forEach((p) => {
    const choose = () => {
      explorerGeneration += 1;
      document.querySelectorAll('.region-map path').forEach((x) => x.classList.toggle('sel', x === p));
      $('explorerDetails').textContent = 'Select a wine.';
      renderChips(p.dataset.region);
    };
    p.addEventListener('click', choose);
    p.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); }
    });
  });
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
  await loadDocuments();
  await loadRegions();
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
  // Capture this reset's generation. If a newer selection/scan/reset
  // supersedes it while the request is in flight, its late completion
  // must not clear the newer state — and a failed reset must never
  // report success.
  const token = ++generation;
  let response;
  try {
    response = await fetch('/api/reset', { method: 'POST' });
    if (!response.ok) throw new Error(`reset_http_${response.status}`);
  } catch (e) {
    if (token !== generation) return;
    // Preserve the current result exactly: wine facts, lastScan and the
    // replay binding stay untouched; the error is shown separately and
    // never as a reset success.
    const resetError = $('resetError');
    resetError.textContent = `Reset failed (${e.message}). Current results were left as they are.`;
    resetError.hidden = false;
    return;
  }
  if (token !== generation) return; // Outdated reset: a newer state owns the UI.
  lastScan = null;
  $('replayBtn').disabled = true;
  $('rescanBtn').disabled = true;
  clearOutcome('Workspace reset.', 'All observations and demand were cleared; the catalog was reseeded.');
  $('result').textContent = 'Nothing scanned yet.';
  // A reset also invalidates every other panel's state: staged/review
  // artifacts no longer exist, chat loses its wine, and explorer and
  // document selections start over. In-flight panel responses are
  // discarded via their generation tokens.
  evidenceGeneration += 1;
  explorerGeneration += 1;
  chatGeneration += 1;
  selectedDocument = null;
  stagedArtifact = null;
  importedReview = null;
  askWineId = null;
  $('stageBtn').disabled = true;
  $('playbackReviewBtn').disabled = true;
  $('publishBtn').disabled = true;
  document.querySelectorAll('.doc-card').forEach((c) => c.classList.remove('sel'));
  $('artifactView').textContent = 'No document staged yet.';
  $('askWineLabel').textContent = 'Match or publish a wine first.';
  $('askAnswer').textContent = 'No question asked yet.';
  document.querySelectorAll('.region-map path').forEach((x) => x.classList.remove('sel'));
  $('regionChips').innerHTML = '';
  $('explorerDetails').textContent = 'Select a region, then a wine.';
  await refreshDemands();
  await loadRegions();
});

load();
