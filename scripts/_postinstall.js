#!/usr/bin/env node
/**
 * _postinstall.js — npm postinstall hook
 *
 * 自动建立 node_modules/@pb/context-cli 符号链接。
 * 如果 pb-context 不在 PATH 中则优雅跳过。
 */
import { execSync } from 'node:child_process';
import { mkdirSync, symlinkSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const target = join('node_modules', '@pb', 'context-cli');

// Already linked?
try {
  statSync(target);
  process.exit(0);
} catch {}

// Find pb-context binary -> resolve to package root
try {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which';
  const bin = execSync(`${whichCmd} pb-context`, { encoding: 'utf8' }).trim().split('\n')[0];
  if (!bin) throw new Error('not found');
  const realBin = realpathSync(bin);
  const pkgRoot = resolve(dirname(realBin), '..');
  mkdirSync(join('node_modules', '@pb'), { recursive: true });
  symlinkSync(pkgRoot, target, 'junction');
  console.log(`✓ Linked @pb/context-cli -> ${pkgRoot}`);
} catch {
  console.log('ℹ️ pb-context not in PATH, skipping @pb/context-cli link');
}
