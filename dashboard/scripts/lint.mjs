import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const ignored = new Set(['node_modules', 'dist', '.vercel']);
const files = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignored.has(entry.name)) await walk(join(directory, entry.name));
    } else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(join(directory, entry.name));
  }
}

await walk(root);
let failed = false;
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failed = true;
    process.stderr.write(`${relative(root, file)}\n${result.stderr}`);
  }
}
if (failed) process.exitCode = 1;
else console.log(`lint: ${files.length} JavaScript files checked`);
