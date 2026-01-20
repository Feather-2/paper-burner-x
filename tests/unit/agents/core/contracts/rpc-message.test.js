import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockedCrypto = vi.hoisted(() => ({
  randomUUID: vi.fn(() => 'req-123'),
}));

vi.mock('node:crypto', () => ({
  randomUUID: mockedCrypto.randomUUID,
}));

import { randomUUID } from 'node:crypto';
import { validateRpcRequest, validateRpcResponse } from '../../../../../js/agents/core/contracts/rpc-message.js';

const buildDeepObject = (depth) => {
  let node = { value: 'leaf' };
  for (let i = 0; i < depth; i += 1) {
    node = { level: i, next: node };
  }
  return node;
};

beforeEach(() => {
  mockedCrypto.randomUUID.mockClear();
  vi.clearAllMocks();
});

describe('validateRpcRequest', () => {
  it('rejects non-object inputs', () => {
    expect(validateRpcRequest(null)).toEqual({ ok: false, error: 'RpcRequest: expected object' });
    expect(validateRpcRequest(undefined)).toEqual({ ok: false, error: 'RpcRequest: expected object' });
    expect(validateRpcRequest('')).toEqual({ ok: false, error: 'RpcRequest: expected object' });
    expect(validateRpcRequest('not-object')).toEqual({ ok: false, error: 'RpcRequest: expected object' });
    expect(validateRpcRequest(0)).toEqual({ ok: false, error: 'RpcRequest: expected object' });
    expect(validateRpcRequest(-1)).toEqual({ ok: false, error: 'RpcRequest: expected object' });
    expect(validateRpcRequest(Number.MAX_SAFE_INTEGER)).toEqual({ ok: false, error: 'RpcRequest: expected object' });
  });

  it('rejects empty object/array and blank type', () => {
    expect(validateRpcRequest({})).toEqual({
      ok: false,
      error: 'RpcRequest.type: required non-empty string',
    });
    expect(validateRpcRequest([])).toEqual({
      ok: false,
      error: 'RpcRequest.type: required non-empty string',
    });
    expect(validateRpcRequest({ type: '' })).toEqual({
      ok: false,
      error: 'RpcRequest.type: required non-empty string',
    });
    expect(validateRpcRequest({ type: '   ', payload: 1 })).toEqual({
      ok: false,
      error: 'RpcRequest.type: required non-empty string',
    });
  });

  it('rejects invalid type patterns and numeric-looking strings', () => {
    const invalidTypes = [
      'ping',
      'Ping:action',
      'ping:Action',
      '1ping:action',
      'ping:1action',
      'ping:act-ion',
      '123',
    ];

    for (const type of invalidTypes) {
      expect(validateRpcRequest({ type, payload: null })).toEqual({
        ok: false,
        error: 'RpcRequest.type: must be domain:action format',
      });
    }
  });

  it('accepts valid type, trims it, and preserves payload/requestId', () => {
    const requestId = randomUUID();
    const payload = { ok: true };
    const out = validateRpcRequest({ type: ' core:ping ', payload, requestId });

    expect(out).toEqual({
      ok: true,
      value: { type: 'core:ping', payload, requestId },
    });
  });

  it('ignores non-string requestId values', () => {
    const out = validateRpcRequest({ type: 'core:ping', payload: 1, requestId: 42 });

    expect(out.ok).toBe(true);
    expect(out.value.requestId).toBeUndefined();
  });

  it('preserves boundary payload values and resource-heavy payloads', () => {
    const boundaryPayloads = [0, -1, Number.MAX_SAFE_INTEGER, '123'];
    for (const payload of boundaryPayloads) {
      const out = validateRpcRequest({ type: 'core:bounds', payload });
      expect(out.ok).toBe(true);
      expect(out.value.payload).toBe(payload);
    }

    const longSegment = 'a'.repeat(10000);
    const longType = `${longSegment}:${longSegment}`;
    const largeString = 'x'.repeat(200000);
    const deepPayload = buildDeepObject(40);
    const out = validateRpcRequest({
      type: longType,
      payload: { largeString, deepPayload },
    });

    expect(out.ok).toBe(true);
    expect(out.value.type).toBe(longType);
    expect(out.value.payload).toEqual({ largeString, deepPayload });
  });

  it('handles concurrent calls independently', async () => {
    const msgs = [
      { type: 'core:ping', payload: { ok: true } },
      { type: 'bad', payload: null },
      null,
      { type: 'core:echo', payload: 'ok', requestId: 'r1' },
    ];

    const results = await Promise.all(msgs.map((msg) => Promise.resolve(validateRpcRequest(msg))));

    expect(results[0]).toEqual({
      ok: true,
      value: { type: 'core:ping', payload: { ok: true }, requestId: undefined },
    });
    expect(results[1]).toEqual({
      ok: false,
      error: 'RpcRequest.type: must be domain:action format',
    });
    expect(results[2]).toEqual({ ok: false, error: 'RpcRequest: expected object' });
    expect(results[3]).toEqual({
      ok: true,
      value: { type: 'core:echo', payload: 'ok', requestId: 'r1' },
    });
  });

  it('handles rapid sequential calls without shared state', () => {
    const msg = { type: 'core:ping', payload: { ok: true } };

    for (let i = 0; i < 50; i += 1) {
      const out = validateRpcRequest(msg);
      expect(out.ok).toBe(true);
      expect(out.value.type).toBe('core:ping');
    }
  });
});

describe('validateRpcResponse', () => {
  it('rejects non-object inputs', () => {
    expect(validateRpcResponse(null)).toEqual({ ok: false, error: 'RpcResponse: expected object' });
    expect(validateRpcResponse(undefined)).toEqual({ ok: false, error: 'RpcResponse: expected object' });
    expect(validateRpcResponse('')).toEqual({ ok: false, error: 'RpcResponse: expected object' });
    expect(validateRpcResponse('not-object')).toEqual({ ok: false, error: 'RpcResponse: expected object' });
    expect(validateRpcResponse(0)).toEqual({ ok: false, error: 'RpcResponse: expected object' });
    expect(validateRpcResponse(-1)).toEqual({ ok: false, error: 'RpcResponse: expected object' });
    expect(validateRpcResponse(Number.MAX_SAFE_INTEGER)).toEqual({ ok: false, error: 'RpcResponse: expected object' });
  });

  it('defaults ok to true and tolerates empty object/array', () => {
    expect(validateRpcResponse({})).toEqual({
      ok: true,
      value: { ok: true, data: undefined, error: undefined, requestId: undefined },
    });
    expect(validateRpcResponse([])).toEqual({
      ok: true,
      value: { ok: true, data: undefined, error: undefined, requestId: undefined },
    });
  });

  it('accepts ok=false and preserves data/error/requestId', () => {
    const requestId = randomUUID();
    const data = { ok: false };

    const out = validateRpcResponse({ ok: false, error: 'boom', requestId, data });

    expect(out).toEqual({
      ok: true,
      value: { ok: false, data, error: 'boom', requestId },
    });
  });

  it('ignores non-string error/requestId and preserves boundary data values', () => {
    const out = validateRpcResponse({ ok: true, error: 123, requestId: {}, data: 0 });

    expect(out).toEqual({
      ok: true,
      value: { ok: true, data: 0, error: undefined, requestId: undefined },
    });
  });

  it('handles resource-heavy data payloads', () => {
    const longString = 'y'.repeat(120000);
    const deepData = buildDeepObject(50);
    const largeArray = Array.from({ length: 10000 }, (_, i) => i);

    const out = validateRpcResponse({ data: { longString, deepData, largeArray } });

    expect(out.ok).toBe(true);
    expect(out.value.data).toEqual({ longString, deepData, largeArray });
  });

  it('handles concurrent calls independently', async () => {
    const msgs = [
      { ok: false, error: 'bad', requestId: 'r1' },
      { data: { ok: true } },
      [],
      null,
    ];

    const results = await Promise.all(msgs.map((msg) => Promise.resolve(validateRpcResponse(msg))));

    expect(results[0]).toEqual({
      ok: true,
      value: { ok: false, data: undefined, error: 'bad', requestId: 'r1' },
    });
    expect(results[1]).toEqual({
      ok: true,
      value: { ok: true, data: { ok: true }, error: undefined, requestId: undefined },
    });
    expect(results[2]).toEqual({
      ok: true,
      value: { ok: true, data: undefined, error: undefined, requestId: undefined },
    });
    expect(results[3]).toEqual({ ok: false, error: 'RpcResponse: expected object' });
  });

  it('handles rapid sequential calls without shared state', () => {
    const msg = { data: { ok: true } };

    for (let i = 0; i < 50; i += 1) {
      const out = validateRpcResponse(msg);
      expect(out.ok).toBe(true);
      expect(out.value.ok).toBe(true);
    }
  });
});
