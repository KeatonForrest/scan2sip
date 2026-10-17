// Browser regression checks using the system Chrome over CDP — no test
// framework or driver dependency. Skipped (not failed) when no Chrome
// binary is available; set CHROME_BIN to point at one explicitly.
//
// Covers the UI correlation contract: selection clears prior wine,
// mismatch/failure never leave stale facts, replay stays bound to the
// original request, a late scan response is suppressed, an outdated
// reset completion cannot clear a newer result, and a failed reset
// preserves current facts without claiming success.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { buildDemo, createApp } from '../src/server.js';

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const chromeBin = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
const skip = chromeBin ? false : 'no Chrome binary found (set CHROME_BIN)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withBrowser(fn) {
  const demo = buildDemo({ dbPath: ':memory:' });
  const server = createApp(demo).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const debugPort = 9300 + Math.floor(Math.random() * 400);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan2sip-chrome-'));
  const chrome = spawn(chromeBin, [
    '--headless=new', '--disable-gpu', '--no-sandbox',
    `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userDataDir}`, 'about:blank',
  ], { stdio: 'ignore' });

  let ws;
  try {
    let version = null;
    for (let i = 0; i < 50 && !version; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
        if (r.ok) version = await r.json();
      } catch { await sleep(200); }
    }
    assert.ok(version, 'chrome debugging endpoint available');
    ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let seq = 0;
    const pending = new Map();
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    };
    const send = (method, params = {}, sessionId) => new Promise((resolve) => {
      const i = ++seq;
      pending.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    const target = await send('Target.createTarget', { url: `${base}/` });
    const attached = await send('Target.attachToTarget', { targetId: target.result.targetId, flatten: true });
    const sid = attached.result.sessionId;
    const evaluate = async (expr) => {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }, sid);
      assert.ok(!r.result?.exceptionDetails, `evaluate failed: ${expr.slice(0, 80)}`);
      return r.result?.result?.value;
    };
    const waitFor = async (expr, label) => {
      for (let i = 0; i < 50; i++) {
        if (await evaluate(expr)) return;
        await sleep(200);
      }
      assert.fail(`timeout waiting for ${label}`);
    };
    await waitFor(`document.querySelectorAll('#scenarios .card').length === 10`, 'UI load');
    await fn({ evaluate, waitFor });
  } finally {
    try { ws?.close(); } catch {}
    chrome.kill();
    server.close();
    await sleep(300);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch { /* temp profile cleanup is best-effort */ }
  }
}

async function scanKnownMatch(evaluate, waitFor) {
  await evaluate(`document.querySelector('.sample[data-fixture="scan-orchard-2021"]').click(); document.getElementById('scanBtn').click(); true`);
  await waitFor(`document.getElementById('outcomeTitle').textContent.includes('Exact catalog match') && document.getElementById('wineFacts').textContent.includes('Syrah')`, 'match rendered');
}

test('browser: correlated UI state, stale-wine and reset-race regressions', { skip }, async () => {
  await withBrowser(async ({ evaluate, waitFor }) => {
    // Match, then mismatch: no stale wine facts at any point.
    await scanKnownMatch(evaluate, waitFor);
    await evaluate(`document.querySelector('.sample[data-fixture="scan-orchard-2022-mismatch"]').click(); true`);
    assert.equal(await evaluate(`document.getElementById('wineFacts').textContent.includes('Syrah')`), false, 'selection clears prior wine');
    await evaluate(`document.getElementById('scanBtn').click(); true`);
    await waitFor(`document.getElementById('outcomeTitle').textContent.includes('No match')`, 'mismatch rendered');
    assert.equal(await evaluate(`document.getElementById('wineFacts').textContent.includes('Syrah')`), false, 'mismatch leaves no stale wine');

    // Replay stays bound to the original (mismatch) request after reselection.
    await evaluate(`document.querySelector('.sample[data-fixture="scan-blurred-orchard"]').click(); document.getElementById('replayBtn').click(); true`);
    await waitFor(`document.getElementById('outcomeTitle').textContent.includes('replayed')`, 'replay rendered');
    assert.equal(await evaluate(`document.getElementById('outcomeText').textContent.includes('original scanned bottle')`), true);

    // Reset race: hold the reset RESPONSE after the server applied it,
    // complete a NEW scan, then release the old reset — the newer match
    // must survive.
    await scanKnownMatch(evaluate, waitFor);
    await evaluate(`(() => {
      const originalFetch = window.fetch.bind(window);
      window.__releaseReset = null;
      window.fetch = (url, opts) => {
        if (String(url).includes('/api/reset')) {
          return originalFetch(url, opts).then((res) => new Promise((resolve) => {
            window.__releaseReset = () => resolve(res);
          }));
        }
        return originalFetch(url, opts);
      };
      return true;
    })()`);
    await evaluate(`document.getElementById('resetBtn').click(); true`);
    await sleep(400); // reset is applied server-side; only its response is held
    await evaluate(`document.getElementById('scanBtn').click(); true`);
    await waitFor(`document.getElementById('outcomeTitle').textContent.includes('Exact catalog match') && document.getElementById('wineFacts').textContent.includes('Syrah')`, 'newer scan rendered while reset held');
    await evaluate(`window.__releaseReset(); true`);
    await sleep(400);
    assert.equal(await evaluate(`document.getElementById('outcomeTitle').textContent.includes('Exact catalog match')`), true, 'outdated reset must not clear the newer match');
    assert.equal(await evaluate(`document.getElementById('wineFacts').textContent.includes('Syrah')`), true, 'newer wine facts survive the outdated reset');
  });
});

test('browser: evidence flow publishes, rescan matches, chat cites, explorer browses', { skip }, async () => {
  await withBrowser(async ({ evaluate, waitFor }) => {
    // Stage the Glassfinch sheet, play the simulated review, publish.
    await evaluate(`document.querySelector('.doc-card[data-doc="glassfinch-aurelia-white"] .doc-select').click(); document.getElementById('stageBtn').click(); true`);
    await waitFor(`document.getElementById('artifactView').textContent.includes('Albariño')`, 'artifact staged');
    assert.equal(await evaluate(`document.getElementById('artifactView').textContent.includes('unsupported')`), true, 'unsupported pairing is visible');
    await evaluate(`document.getElementById('playbackReviewBtn').click(); true`);
    await waitFor(`document.getElementById('artifactView').textContent.includes('simulated-playback')`, 'playback review imported');
    await evaluate(`document.getElementById('publishBtn').click(); true`);
    await waitFor(`document.getElementById('artifactView').textContent.includes('published')`, 'publication shown');
    // Rescan the previously unknown bottle: it now matches.
    await evaluate(`document.querySelector('#scenarios .card[data-fixture="scan-unknown-glassfinch"]').click(); document.getElementById('scanBtn').click(); true`);
    await waitFor(`document.getElementById('outcomeTitle').textContent.includes('Exact catalog match')`, 'rescan matched');
    // Ask the exact UI grape question: varietal answer with citation.
    await evaluate(`[...document.querySelectorAll('.ask-q')].find((b) => b.textContent.includes('What grape')).click(); true`);
    await waitFor(`document.getElementById('askAnswer').textContent.includes('Albariño')`, 'grape answer');
    assert.equal(await evaluate(`document.getElementById('askAnswer').textContent.includes('simulated-playback')`), true, 'chat shows review classification');
    // Explorer: keyboard-select Pale Coast, open the Glassfinch chip.
    await evaluate(`(() => { const p = document.querySelector('.region-map path[data-region="Pale Coast"]'); p.focus(); p.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); return true; })()`);
    await waitFor(`document.getElementById('regionChips').textContent.includes('Glassfinch')`, 'region chips');
    await evaluate(`document.querySelector('#regionChips .chip-btn').click(); true`);
    await waitFor(`document.getElementById('explorerDetails').textContent.includes('Pale Coast')`, 'explorer details');
    // Reset invalidates the staged evidence state.
    await evaluate(`document.getElementById('resetBtn').click(); true`);
    await waitFor(`document.getElementById('artifactView').textContent.includes('No document staged')`, 'reset clears evidence panel');
  });
});

test('browser: failed reset (HTTP 500) preserves current facts and claims no success', { skip }, async () => {
  await withBrowser(async ({ evaluate, waitFor }) => {
    await scanKnownMatch(evaluate, waitFor);
    // Force /api/reset to fail with HTTP 500 in the page.
    await evaluate(`(() => {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (url, opts) => String(url).includes('/api/reset')
        ? Promise.resolve(new Response('simulated reset failure', { status: 500 }))
        : originalFetch(url, opts);
      return true;
    })()`);
    await evaluate(`document.getElementById('resetBtn').click(); true`);
    await waitFor(`!document.getElementById('resetError').hidden && document.getElementById('resetError').textContent.includes('Reset failed')`, 'reset error shown');
    assert.equal(await evaluate(`document.getElementById('outcomeTitle').textContent.includes('Exact catalog match')`), true, 'no reset-success claim replaces the match');
    assert.equal(await evaluate(`document.getElementById('outcomeTitle').textContent.includes('Workspace reset')`), false, 'no reset-success claim');
    assert.equal(await evaluate(`document.getElementById('wineFacts').textContent.includes('Syrah')`), true, 'current wine facts remain after failed reset');
    assert.equal(await evaluate(`document.getElementById('replayBtn').disabled`), false, 'lastScan/replay binding preserved after failed reset');
  });
});
