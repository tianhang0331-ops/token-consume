'use strict';

/**
 * Lightweight syntax gate: runs `node --check` on every JavaScript file.
 * Usage: npm run check
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TARGETS = ['src', 'scripts', 'tests'];
const files = [];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push(fullPath);
    }
  }
}

for (const target of TARGETS) {
  const directory = path.join(ROOT, target);
  if (fs.existsSync(directory)) walk(directory);
}

let failures = 0;
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failures += 1;
    console.error(`FAIL ${path.relative(ROOT, file)}`);
    console.error(result.stderr.trim());
  }
}

console.log(`checked ${files.length} file(s), ${failures} failure(s)`);
process.exit(failures ? 1 : 0);
