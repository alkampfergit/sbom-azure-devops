#!/usr/bin/env node
// Opens the perf harness (real SbomDocumentPage component, large synthetic SBOM) in a VISIBLE
// Chromium window for manual inspection -- companion to measureRenderPerf.js's automated timing.
// The window is left open; the process exits once you close it (or Ctrl+C).
//
// Usage: node ui/test/openVisible.js [fixturePath]

const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync } = require('child_process');

const UI_DIR = path.join(__dirname, '..');
const DIST_DIR = path.join(__dirname, '.generated', 'dist-perf');
const DEFAULT_FIXTURE = path.join(__dirname, '.generated', 'large-manifest.spdx.json');
const PORT = 4758;

function log(message) {
  console.log(`[openVisible] ${message}`);
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
    if (req.url === '/' || req.url === '/perfHarness.html') filePath = path.join(DIST_DIR, 'perfHarness.html');
    else if (req.url === '/large-manifest.spdx.json') filePath = fixturePath;
    else filePath = path.join(DIST_DIR, decodeURIComponent(req.url));
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

async function main() {
  const fixturePath = process.argv[2] || DEFAULT_FIXTURE;
  if (!fs.existsSync(fixturePath)) {
    console.error(`Fixture not found: ${fixturePath}`);
    console.error('Generate one first: node ui/test/generateLargeSbomFixture.js');
    process.exit(1);
  }

  const { chromium } = require('playwright');
  const fixtureSizeMiB = fs.statSync(fixturePath).size / 1024 / 1024;
  log(`Fixture: ${fixturePath} (${fixtureSizeMiB.toFixed(1)} MiB)`);

  buildHarness();
  const server = await serveDist(fixturePath);
  log(`Serving on http://localhost:${PORT}/`);

  const browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
  const page = await browser.newPage({ viewport: null });
  page.on('pageerror', (err) => log(`browser page error: ${err}`));
  await page.goto(`http://localhost:${PORT}/`);
  log('Window open -- close it (or Ctrl+C here) when done.');

  await new Promise((resolve) => {
    browser.on('disconnected', resolve);
    process.on('SIGINT', async () => {
      await browser.close().catch(() => {});
      resolve();
    });
  });
  server.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
