// scripts/build.mjs — assembles a self-contained dist/ for Tauri
// Usage:
//   node scripts/build.mjs           one-shot production build
//   node scripts/build.mjs --watch   esbuild watch + one-time static copy

import * as esbuild from 'esbuild';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { readFile, writeFile, copyFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');

// Read version from package.json
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
const APP_VERSION = pkg.version;

const watch = process.argv.includes('--watch');

// ── helpers ─────────────────────────────────────────────────────────────────

async function ensureDir(dir) {
  await mkdir(dir, { recursive: true });
}

/** Copy a single file, creating the destination directory if needed. */
async function cp(src, dest) {
  await ensureDir(dirname(dest));
  await copyFile(src, dest);
}

/** Recursively copy a directory tree. */
async function cpDir(src, dest) {
  await ensureDir(dest);
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dest, entry.name);
    if (entry.isDirectory()) {
      await cpDir(s, d);
    } else {
      await copyFile(s, d);
    }
  }
}

/** Copy index.html → dist/index.html, rewriting absolute asset paths. */
async function copyIndexHtml() {
  let html = await readFile(join(ROOT, 'index.html'), 'utf8');

  // Stylesheet: /src/themes/styles.css → styles.css
  html = html.replace(
    /href="\/src\/themes\/styles\.css"/g,
    'href="styles.css"'
  );

  // Icon: /src/assets/brand/<name>.png → assets/<name>.png
  html = html.replace(
    /href="\/src\/assets\/brand\/(praetorium-icon-128\.png)"/g,
    'href="assets/$1"'
  );

  // Script: /dist/app.js → app.js
  html = html.replace(
    /src="\/dist\/app\.js"/g,
    'src="app.js"'
  );

  await writeFile(join(DIST, 'index.html'), html, 'utf8');
}

/** Copy static assets (CSS, fonts, icon) into dist/. */
async function copyStatics() {
  // styles.css
  await cp(
    join(ROOT, 'src/themes/styles.css'),
    join(DIST, 'styles.css')
  );

  // fonts/ directory
  await cpDir(
    join(ROOT, 'src/themes/fonts'),
    join(DIST, 'fonts')
  );

  // brand icon
  await cp(
    join(ROOT, 'src/assets/brand/praetorium-icon-128.png'),
    join(DIST, 'assets/praetorium-icon-128.png')
  );

  // index.html (rewritten)
  await copyIndexHtml();
}

// ── esbuild config ───────────────────────────────────────────────────────────

const buildOptions = {
  entryPoints: [join(ROOT, 'entry.jsx')],
  outfile: join(DIST, 'app.js'),
  bundle: true,
  target: 'es2020',
  loader: { '.jsx': 'jsx' },
  jsx: 'automatic',
  minify: !watch,
  legalComments: 'none',
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  // sourcemap in watch mode for easier debugging
  sourcemap: watch ? true : false,
};

// ── main ─────────────────────────────────────────────────────────────────────

if (watch) {
  // One-time static copy, then keep esbuild watching app.js
  await ensureDir(DIST);
  await copyStatics();
  console.log('[build] static assets copied');

  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log(`[build] watching entry.jsx … (Ctrl+C to stop)`);
} else {
  // Clean dist/, then build everything
  if (existsSync(DIST)) {
    await rm(DIST, { recursive: true, force: true });
  }
  await ensureDir(DIST);

  // Run esbuild and static copies in parallel
  await Promise.all([
    esbuild.build(buildOptions),
    copyStatics(),
  ]);

  console.log(`[build] dist/ assembled (v${APP_VERSION})`);
}
