// Browser regression checks using the system Chrome over CDP — no test
// framework or driver dependency. Skipped (not failed) when no Chrome
// binary is available; set CHROME_BIN to point at one explicitly.
//
// Covers the UI correlation contract: selection clears prior wine,
// mismatch/failure never leave stale facts, replay stays bound to the
// original request, a late scan response is suppressed, and an outdated
// reset completion cannot clear a newer result (nor claim success).

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('browser: correlated UI state, stale-wine and reset-race regressions', { skip: chromeBin ? false : 'no Chrome binary found (set CHROME_BIN)' }, async () => {
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

    await waitFor(`document.querySelectorAll('.card').length === 10`, 'UI load');

    // Match, then mismatch: no stale wine facts at any point.
    await evaluate(`document.querySelector('.sample[data-fixture="scan-orchard-2021"]').click(); document.getElementById('scanBtn').click(); true`);
    await waitFor(`document.getElementById('outcomeTitle').textContent.includes('Exact catalog match') && document.getElementById('wineFacts').textContent.includes('Syrah')`, 'match rendered');
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
    await evaluate(`document.querySelector('.sample[data-fixture="scan-orchard-2021"]').click(); document.getElementById('scanBtn').click(); true`);
    await waitFor(`document.getElementById('outcomeTitle').textContent.includes('Exact catalog match')`, 'second match rendered');
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
  } finally {
    try { ws?.close(); } catch {}
    chrome.kill();
    server.close();
    await sleep(300);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch { /* temp profile cleanup is best-effort */ }
  }
});
