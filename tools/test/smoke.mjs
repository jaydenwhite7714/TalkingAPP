#!/usr/bin/env node
// Static smoke tests for TalkingApp (no browser required).
//   npm test
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let failures = 0;
const ok = (msg) => console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
const fail = (msg) => { failures++; console.log(`  \x1b[31m✗\x1b[0m ${msg}`); };

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

console.log('\nSyntax');
const jsFiles = walk(path.join(root, 'assets/js')).filter((f) => f.endsWith('.js'));
for (const file of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    ok(path.relative(root, file));
  } catch (err) {
    fail(`${path.relative(root, file)} — ${err.stderr?.toString().split('\n').slice(0, 3).join(' ')}`);
  }
}

console.log('\nAssets referenced by index.html exist');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:href|src)="(?!http|data:|#)([^"]+)"/g)].map((m) => m[1]);
for (const ref of new Set(refs)) {
  const target = path.join(root, ref);
  if (fs.existsSync(target)) ok(ref);
  else fail(`missing ${ref}`);
}

console.log('\nCSS fonts + modules resolve');
for (const cssFile of walk(path.join(root, 'assets/css')).filter((f) => f.endsWith('.css'))) {
  const css = fs.readFileSync(cssFile, 'utf8');
  for (const m of css.matchAll(/url\("([^"]+)"\)/g)) {
    if (m[1].startsWith('data:')) continue;
    const target = path.resolve(path.dirname(cssFile), m[1]);
    if (!fs.existsSync(target)) fail(`${path.relative(root, cssFile)} → missing ${m[1]}`);
  }
}
ok('font and image urls');

const importRe = /from\s+['"](\.[^'"]+)['"]/g;
let importCount = 0;
for (const file of jsFiles) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(importRe)) {
    importCount++;
    const target = path.resolve(path.dirname(file), m[1]);
    if (!fs.existsSync(target)) fail(`${path.relative(root, file)} → missing ${m[1]}`);
  }
}
ok(`${importCount} relative module imports resolve`);

console.log('\nExports used across modules');
const exportsByFile = new Map();
for (const file of jsFiles) {
  const src = fs.readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop().trim();
      if (name) names.add(name);
    }
  }
  exportsByFile.set(path.resolve(file), names);
}
let checkedImports = 0;
for (const file of jsFiles) {
  const src = fs.readFileSync(file, 'utf8');
  for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
    const target = path.resolve(path.dirname(file), m[2]);
    const available = exportsByFile.get(target);
    if (!available) continue;
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      checkedImports++;
      if (!available.has(name)) fail(`${path.relative(root, file)} imports missing "${name}" from ${m[2]}`);
    }
  }
}
ok(`${checkedImports} named imports verified`);

console.log('\nHTML structure');
for (const id of ['bootScreen', 'onboarding', 'signupForm', 'app', 'rail', 'sidebar', 'chat', 'messagesInner', 'composerArea', 'modalRoot', 'toastRoot']) {
  if (html.includes(`id="${id}"`)) ok(`#${id}`);
  else fail(`#${id} missing`);
}
const required = ['assets/vendor/mqtt.min.js', 'assets/fonts/emoji-fallback.woff2', '404.html', '.github/workflows/pages.yml', 'tools/relay/server.mjs'];
for (const rel of required) {
  if (fs.existsSync(path.join(root, rel))) ok(rel);
  else fail(`${rel} missing`);
}

console.log(failures ? `\n\x1b[31m${failures} check(s) failed\x1b[0m\n` : '\n\x1b[32mAll checks passed\x1b[0m\n');
process.exit(failures ? 1 : 0);
