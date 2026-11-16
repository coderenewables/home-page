/* Copyright 2026 Nithish Seenivasagam (coderenewables.com). SPDX-License-Identifier: Apache-2.0
 * Phase 0 checks: the suite hub, the client and the project bar.
 * Usage: node tests/suite.test.js   (needs Playwright with Chromium; starts two static servers on 8100 and 8101) */
'use strict';
const assert = require('assert');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const HUB_PORT = 8100;
const PAGE_PORT = 8101;
const DEAD_PORT = 8199;
const HUB = `http://localhost:${HUB_PORT}/suite/v1/hub.html`;
const page = (q) => `http://localhost:${PAGE_PORT}/tests/fixtures/page.html${q ? '?' + q : ''}`;

function serve(port) {
  return spawn('python3', ['-m', 'http.server', String(port), '--directory', ROOT], { stdio: 'ignore' });
}
function waitUp(url, tries = 50) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      http.get(url, (res) => { res.resume(); resolve(); }).on('error', () => {
        if (n <= 0) return reject(new Error('server did not start: ' + url));
        setTimeout(() => attempt(n - 1), 100);
      });
    };
    attempt(tries);
  });
}
function waitFor(fn, ms = 4000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try { if (await fn()) return resolve(); } catch (e) { /* keep waiting */ }
      if (Date.now() - t0 > ms) return reject(new Error('timed out waiting'));
      setTimeout(tick, 50);
    };
    tick();
  });
}

async function main() {
  const servers = [serve(HUB_PORT), serve(PAGE_PORT)];
  let passed = 0;
  let failed = 0;
  const check = async (name, fn) => {
    try {
      await fn();
      passed++;
      console.log('ok   ' + name);
    } catch (e) {
      failed++;
      console.log('FAIL ' + name + ': ' + e.message);
    }
  };
  let browser;
  try {
    await waitUp(HUB);
    await waitUp(page(''));
    browser = await chromium.launch();

    // 1-2 shared mode, create, list, write, read back
    const ctx = await browser.newContext();
    const p1 = await ctx.newPage();
    await p1.goto(page(''));
    let projectId;
    await check('ready resolves in shared mode', async () => {
      const mode = await p1.evaluate(async () => (await CRSuite.ready).mode);
      assert.strictEqual(mode, 'shared');
    });
    await check('create, list, write and read back', async () => {
      const made = await p1.evaluate(() => CRSuite.create({ name: 'Test wind', tech: 'wind' }));
      projectId = made.id;
      const list = await p1.evaluate(() => CRSuite.list());
      assert.ok(list.projects.some((x) => x.id === projectId && x.name === 'Test wind'));
      const before = made.rev;
      await p1.evaluate(() => CRSuite.write('lossstack', { a: 1 }));
      const cur = await p1.evaluate(() => CRSuite.current());
      assert.strictEqual(cur.id, projectId);
      assert.deepStrictEqual(cur.sections.lossstack.value, { a: 1 });
      assert.ok(cur.rev > before, 'rev increased');
    });

    // 3 a second page in the same browser receives the change
    await check('second page receives onChange with own false', async () => {
      const p2 = await ctx.newPage();
      await p2.goto(page(`project=${projectId}`));
      await p2.evaluate(async () => {
        await CRSuite.ready;
        window.__events = [];
        CRSuite.onChange((e) => window.__events.push({ own: e.own, section: e.section }));
      });
      await p1.evaluate(() => CRSuite.write('lossstack', { a: 2 }));
      await waitFor(() => p2.evaluate(() => window.__events.length > 0));
      const ev = await p2.evaluate(() => window.__events[0]);
      assert.strictEqual(ev.own, false);
      assert.strictEqual(ev.section, 'lossstack');
      const v = await p2.evaluate(async () => CRSuite.section(await CRSuite.current(), 'lossstack'));
      assert.deepStrictEqual(v, { a: 2 });
      await p2.close();
    });

    // 4 bad input is refused with a code
    await check('bad section and oversized value are refused', async () => {
      const bogus = await p1.evaluate(() => CRSuite.write('bogus', {}).then(() => 'ok', (e) => e.code));
      assert.strictEqual(bogus, 'bad_args');
      const big = await p1.evaluate(() => CRSuite.write('wattodds', 'x'.repeat(400001)).then(() => 'ok', (e) => e.code));
      assert.strictEqual(big, 'too_large');
    });

    // 5 origin check, tested on the hub page itself
    await check('origin check accepts and refuses the right origins', async () => {
      const hp = await ctx.newPage();
      await hp.goto(HUB);
      const expect = {
        'https://lossstack.coderenewables.com': true,
        'https://coderenewables.com': true,
        'http://localhost:8101': true,
        'https://evil.com': false,
        'https://coderenewables.com.evil.com': false,
        'http://lossstack.coderenewables.com': false,
        'null': false
      };
      for (const [origin, want] of Object.entries(expect)) {
        const got = await hp.evaluate((o) => window.__crHubTest.allowedOrigin(o), origin);
        assert.strictEqual(got, want, origin);
      }
      await hp.close();
    });

    // 6 dead hub: local mode, still working
    await check('dead hub falls back to local mode within 2.5 s', async () => {
      const lp = await (await browser.newContext()).newPage();
      await lp.goto(page(`hub=http://localhost:${DEAD_PORT}/suite/v1/hub.html`));
      const t0 = Date.now();
      const mode = await lp.evaluate(async () => (await CRSuite.ready).mode);
      const elapsed = Date.now() - t0;
      assert.strictEqual(mode, 'local');
      assert.ok(elapsed < 2500, 'ready in ' + elapsed + ' ms');
      await lp.evaluate(async () => {
        const made = await CRSuite.create({ name: 'Offline', tech: 'solar' });
        await CRSuite.write('solarnudge', { ok: true });
        const cur = await CRSuite.current();
        if (cur.id !== made.id) throw new Error('current wrong');
      });
      const note = await lp.textContent('.crs-bar .crs-mode');
      assert.strictEqual(note, 'Saved in this tool only');
      await lp.close();
    });

    // 7 bar: layout at 375 px and keyboard creation
    await check('bar fits 375 px and the picker creates a project by keyboard', async () => {
      const bp = await ctx.newPage();
      await bp.setViewportSize({ width: 375, height: 700 });
      await bp.goto(page(`project=${projectId}&tool=windnudge`));
      await bp.waitForSelector('.crs-bar .crs-chip');
      const overflow = await bp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, 'horizontal overflow ' + overflow + ' px');
      assert.strictEqual(await bp.locator('.crs-bar [aria-current="page"]').textContent().then((t) => t.trim().startsWith('WindNudge')), true);
      await bp.selectOption('select[aria-label="Project"]', '__new_wind');
      await bp.keyboard.type('Keyboard project');
      await bp.keyboard.press('Enter');
      await waitFor(async () => {
        const l = await bp.evaluate(() => CRSuite.list());
        return l.projects.some((x) => x.name === 'Keyboard project');
      });
      await bp.close();
    });
  } finally {
    if (browser) await browser.close();
    servers.forEach((s) => s.kill());
  }
  console.log(`suite: ${passed} checks passed${failed ? `, ${failed} failed` : ''}`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
