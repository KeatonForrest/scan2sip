let scenarios = [];
let selected = null;
let lastRequestId = null;

const $ = (id) => document.getElementById(id);

async function load() {
  scenarios = (await (await fetch('/api/fixtures')).json()).scenarios;
  $('scenarios').innerHTML = scenarios.map((s, i) => `
    <button class="card" data-i="${i}">
      <img src="/fixtures/${s.label}" alt="Synthetic label for ${s.title}">
      <span>${s.title}</span><small>expected: ${s.expect}</small>
    </button>`).join('');
  document.querySelectorAll('.card').forEach((el) => {
    el.addEventListener('click', () => {
      selected = scenarios[Number(el.dataset.i)];
      document.querySelectorAll('.card').forEach((c) => c.classList.remove('sel'));
      el.classList.add('sel');
      $('scanBtn').disabled = false;
      $('result').textContent = `Selected: ${selected.title}`;
    });
  });
  await refreshDemands();
}

async function postScan(requestId) {
  const res = await fetch('/api/scans', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fixture_id: selected.fixture_id, request_id: requestId }),
  });
  const body = await res.json();
  $('result').textContent = JSON.stringify(body, null, 2);
  $('replayBtn').disabled = $('rescanBtn').disabled = false;
  if (body.wine_id) await showWine(body.wine_id);
  await refreshDemands();
}

async function showWine(id) {
  const { wine } = await (await fetch(`/api/wines/${id}`)).json();
  $('wine').innerHTML = `<h3>${wine.producer} · ${wine.name} · ${wine.vintage ?? 'vintage unknown'}</h3>` +
    Object.entries(wine.fields).map(([field, f]) => `
      <div class="field"><span class="fname">${field}</span>
      <span>${f.value ?? '—'}</span>
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

$('scanBtn').addEventListener('click', () => {
  lastRequestId = `req-${Date.now()}`;
  postScan(lastRequestId);
});
$('replayBtn').addEventListener('click', () => lastRequestId && postScan(lastRequestId));
$('rescanBtn').addEventListener('click', () => {
  lastRequestId = `req-${Date.now()}-rescan`;
  postScan(lastRequestId);
});
$('resetBtn').addEventListener('click', async () => {
  await fetch('/api/reset', { method: 'POST' });
  $('result').textContent = 'Workspace reset.';
  $('wine').textContent = 'No matched wine yet.';
  await refreshDemands();
});

load();
