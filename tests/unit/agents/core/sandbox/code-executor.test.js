/**
 * Tests for unified CodeExecutor interface — normalizeSystemResult / normalizeWasmResult
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeSystemResult,
  normalizeWasmResult,
  validateConfig,
  SANDBOX_LEVELS,
  AUTO_PRIORITY,
} from '../../../../../js/agents/core/sandbox/sandbox-interface.js';

describe('normalizeSystemResult', () => {
  it('converts successful system result', () => {
    const raw = { code: 0, stdout: 'hello', stderr: '', backend: 'bubblewrap' };
    const result = normalizeSystemResult(raw, 150);
    expect(result.ok).toBe(true);
    expect(result.value).toBe('hello');
    expect(result.error).toBeUndefined();
    expect(result.logs).toBe('hello');
    expect(result.durationMs).toBe(150);
    expect(result.backend).toBe('bubblewrap');
  });

  it('converts failed system result', () => {
    const raw = { code: 1, stdout: '', stderr: 'not found', backend: 'docker' };
    const result = normalizeSystemResult(raw, 200);
    expect(result.ok).toBe(false);
    expect(result.value).toBeNull();
    expect(result.error).toBe('not found');
    expect(result.backend).toBe('docker');
  });

  it('uses exit code in error when stderr is empty', () => {
    const raw = { code: 137, stdout: '', stderr: '' };
    const result = normalizeSystemResult(raw);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Exit code 137');
  });

  it('defaults backend to bubblewrap', () => {
    const raw = { code: 0, stdout: 'ok', stderr: '' };
    expect(normalizeSystemResult(raw).backend).toBe('bubblewrap');
  });
});

describe('normalizeWasmResult', () => {
  it('converts successful wasm result', () => {
    const raw = { ok: true, value: 42, durationMs: 10 };
    const result = normalizeWasmResult(raw, 'wasm');
    expect(result.ok).toBe(true);
    expect(result.value).toBe(42);
    expect(result.durationMs).toBe(10);
    expect(result.backend).toBe('wasm');
  });

  it('converts failed wasm result', () => {
    const raw = { ok: false, error: 'ReferenceError', stack: 'at line 1', durationMs: 5 };
    const result = normalizeWasmResult(raw, 'worker');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('ReferenceError');
    expect(result.stack).toBe('at line 1');
    expect(result.backend).toBe('worker');
  });

  it('defaults backend to wasm', () => {
    const raw = { ok: true, value: null, durationMs: 0 };
    expect(normalizeWasmResult(raw).backend).toBe('wasm');
  });
});
