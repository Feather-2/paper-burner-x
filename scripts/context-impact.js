#!/usr/bin/env node
/** Thin wrapper -> pb-context impact */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  execFileSync('pb-context', ['impact', '--project', root, ...process.argv.slice(2)], { stdio: 'inherit' });
} catch (e) {
  if (e.code === 'ENOENT') console.error('pb-context not found in PATH. Install @pb/context-cli globally.');
  process.exit(e.status ?? 1);
}
