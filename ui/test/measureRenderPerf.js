#!/usr/bin/env node
// Measures real browser render performance of the SBOM report tab's UI, using the actual
// production component tree (SbomDocumentPage) and a real headless Chromium via Playwright --
// not a hand-mirrored algorithm benchmark. See ../../.claude/skills/sbom-render-perf/SKILL.md.
//
// Usage: node ui/test/measureRenderPerf.js [fixturePath]
// Requires: `npx playwright install chromium` once, and the fixture built by
// generateLargeSbomFixture.js (this script builds the harness bundle itself, but does NOT
// regenerate the fixture -- run generateLargeSbomFixture.js first, or point at your own file).

const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');

const UI_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(__dirname, '.generated', 'dist-perf');
const DEFAULT_FIXTURE = path.join(__dirname, '.generated', 'large-manifest.spdx.json');
const PORT = 4756;

function log(message) {
  console.log(`[measureRenderPerf] ${message}`);
}

function buildHarness() {
  log('Building perf harness bundle...');
  execFileSync('npx', ['webpack', '--config', 'webpack.perf.config.js'], {
    cwd: UI_DIR,
    stdio: 'inherit',
    shell: true,
  });
}

function serveDist(fixturePath) {
  const server = http.createServer((req, res) => {
    let filePath;
    if (req.url === '/' || req.url === '/perfHarness.html') {
      filePath = path.join(DIST_DIR, 'perfHarness.html');
    } else if (req.url === '/large-manifest.spdx.json') {
      filePath = fixturePath;
    } else {
      filePath = path.join(DIST_DIR, decodeURIComponent(req.url));
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      const contentType = ext === '.js' ? 'application/javascript' : ext === '.json' ? 'application/json' : 'text/html';
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

async function measure(fixturePath) {
  const { chromium } = require('playwright');

  const fixtureSizeMiB = fs.statSync(fixturePath).size / 1024 / 1024;
  log(`Fixture: ${fixturePath} (${fixtureSizeMiB.toFixed(1)} MiB)`);

  buildHarness();
  const server = await serveDist(fixturePath);
  log(`Serving on http://localhost:${PORT}/`);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') log(`browser console error: ${msg.text()}`);
    });
    page.on('pageerror', (err) => log(`browser page error: ${err}`));

    const navStart = Date.now();
    await page.goto(`http://localhost:${PORT}/`);

    // Wait for the harness to report it finished the initial React render (see perfHarness.tsx).
    await page.waitForFunction(
      () => window.__perfHarness?.status === 'ready' || window.__perfHarness?.status === 'error',
      {
        timeout: 120000,
      },
    );
    const harnessState = await page.evaluate(() => window.__perfHarness);
    if (harnessState.status === 'error') {
      throw new Error(`Harness failed to load: ${harnessState.error}`);
    }
    const timeToReadyMs = Date.now() - navStart;

    // Wall-clock time until the Summary tab's content is actually visible/interactive, as a real
    // user would experience it (independent of the JS-side render() callback timing above).
    await page.waitForSelector('text=Total Files');

    const results = { fixtureSizeMiB, ...harnessState.timings, wallClockToReadyMs: timeToReadyMs };

    // Tab switches and filter interactions: each measured as real wall-clock time from click to
    // the next paint settling (Playwright's actionability checks + a settle wait). Each step is
    // independent -- one failing (e.g. a selector Playwright can't resolve) shouldn't lose the
    // timings already collected, so results are logged incrementally rather than only at the end.
    async function timeStep(label, fn) {
      const start = Date.now();
      try {
        await fn();
        results[label] = Date.now() - start;
        log(`${label}: ${results[label]}ms`);
      } catch (err) {
        log(`${label}: FAILED (${err.message.split('\n')[0]})`);
      }
    }

    async function timeClick(label, selector) {
      await timeStep(label, async () => {
        await page.click(selector);
        await page.waitForTimeout(50); // let React commit + browser paint
      });
    }

    await timeClick('clickPackagesTabMs', 'text=Packages');
    await timeClick('clickFilesTabMs', 'text=Files');
    await timeClick('clickSummaryTabMs', 'text=Summary');

    // Vulnerability filter interactions on the Summary tab: open a dropdown and pick an option --
    // exercises the filtering/aggregation path added for the new vulnerability filters.
    async function timeFilterSelection(label, dropdownLabelText, optionText) {
      await timeStep(label, async () => {
        await page.locator(`text=${dropdownLabelText}`).first().click();
        const option = page.getByRole('option', { name: optionText, exact: true });
        if (await option.count()) {
          await option.first().click();
        } else {
          await page.click(`text=${optionText}`);
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(50);
      });
    }

    await timeFilterSelection('severityFilterInteractionMs', 'Severity', 'Critical');
    await timeFilterSelection('packageManagerFilterInteractionMs', 'Package Manager', 'Npm');

    return results;
  } finally {
    await browser.close();
    server.close();
  }
}

async function main() {
  const fixturePath = process.argv[2] || DEFAULT_FIXTURE;
  if (!fs.existsSync(fixturePath)) {
    console.error(`Fixture not found: ${fixturePath}`);
    console.error('Generate one first: node ui/test/generateLargeSbomFixture.js');
    process.exit(1);
  }

  const results = await measure(fixturePath);
  console.log('\n=== Render performance results ===');
  for (const [key, value] of Object.entries(results)) {
    console.log(`  ${key}: ${typeof value === 'number' ? value.toFixed(1) : value}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
