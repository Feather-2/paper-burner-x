import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../../js/agents/shared/index.js', () => ({
  StageApiSpec: { name: 'StageApiSpecMock' },
  validateStageApi: vi.fn(),
  createStageApi: vi.fn(),
  extractServices: vi.fn(),
  mergeStageApis: vi.fn(),
  createChildApi: vi.fn(),
}));

import * as shared from '../../../../../../js/agents/shared/index.js';
import {
  StageApiSpec,
  validateStageApi,
  createStageApi,
  extractServices,
  mergeStageApis,
  createChildApi,
} from '../../../../../../js/agents/stages/deepsearch/utils/stage-api.js';

beforeEach(() => {
  vi.resetAllMocks();
  shared.validateStageApi.mockReturnValue({ valid: true, missing: [], warnings: [] });
  shared.createStageApi.mockImplementation((partial = {}, options = {}) => ({ partial, options }));
  shared.extractServices.mockImplementation((stageApi) => ({ stageApi }));
  shared.mergeStageApis.mockImplementation((...apis) => ({ apis }));
  shared.createChildApi.mockImplementation((parentApi, overrides = {}) => ({ parentApi, overrides }));
});

describe('StageApiSpec', () => {
  it('re-exports StageApiSpec from shared module', () => {
    expect(StageApiSpec).toBe(shared.StageApiSpec);
  });
});

describe('validateStageApi', () => {
  it('delegates to shared validateStageApi and returns the result', () => {
    const api = { signal: new AbortController().signal, emit: vi.fn() };
    const expected = { valid: false, missing: ['signal'], warnings: ['warn'] };
    shared.validateStageApi.mockReturnValueOnce(expected);

    const result = validateStageApi(api);

    expect(shared.validateStageApi).toHaveBeenCalledTimes(1);
    expect(shared.validateStageApi).toHaveBeenCalledWith(api);
    expect(result).toBe(expected);
  });

  it.each([
    null,
    undefined,
    '',
    '   ',
    [],
    {},
    0,
    -1,
    Number.MAX_SAFE_INTEGER,
    '123',
    { 0: 'x', length: 1 },
  ])('forwards boundary input %p', (input) => {
    const expected = { valid: true, missing: [], warnings: [] };
    shared.validateStageApi.mockReturnValueOnce(expected);

    const result = validateStageApi(input);

    expect(shared.validateStageApi).toHaveBeenCalledWith(input);
    expect(result).toBe(expected);
  });

  it('propagates errors from shared validateStageApi', () => {
    shared.validateStageApi.mockImplementation(() => {
      throw new Error('boom');
    });

    expect(() => validateStageApi({})).toThrow('boom');
  });
});

describe('createStageApi', () => {
  it('delegates to shared createStageApi with partial and options', () => {
    const partial = {
      signal: new AbortController().signal,
      emit: vi.fn(),
      logger: { info: vi.fn() },
    };
    const options = { strict: true };
    const expected = { id: 'stage-api' };
    shared.createStageApi.mockReturnValueOnce(expected);

    const result = createStageApi(partial, options);

    expect(shared.createStageApi).toHaveBeenCalledWith(partial, options);
    expect(result).toBe(expected);
  });

  it('uses default parameters when omitted', () => {
    const result = createStageApi();

    expect(shared.createStageApi).toHaveBeenCalledWith({}, {});
    expect(result).toEqual({ partial: {}, options: {} });
  });

  it('forwards large strings and deeply nested payloads', () => {
    const longString = 'x'.repeat(100_000);
    const hugeFile = 'y'.repeat(1024 * 1024);
    const buildNested = (depth) => {
      let node = { value: 'leaf' };
      for (let i = 0; i < depth; i += 1) {
        node = { next: node };
      }
      return node;
    };

    const partial = {
      externalSearchProvider: { fileContent: hugeFile },
      localRetriever: { tree: buildNested(60) },
      logger: { message: longString },
    };
    const options = { strict: false };
    const expected = { ok: true };
    shared.createStageApi.mockReturnValueOnce(expected);

    const result = createStageApi(partial, options);

    expect(shared.createStageApi).toHaveBeenCalledWith(partial, options);
    expect(shared.createStageApi.mock.calls[0][0]).toBe(partial);
    expect(result).toBe(expected);
  });

  it('propagates errors from shared createStageApi', () => {
    shared.createStageApi.mockImplementation(() => {
      throw new TypeError('invalid');
    });

    expect(() => createStageApi({})).toThrow('invalid');
  });
});

describe('extractServices', () => {
  it('delegates to shared extractServices and returns the result', () => {
    const stageApi = { signal: new AbortController().signal, emit: vi.fn() };
    const expected = { signal: stageApi.signal, emit: stageApi.emit, checkCancelled: vi.fn() };
    shared.extractServices.mockReturnValueOnce(expected);

    const result = extractServices(stageApi);

    expect(shared.extractServices).toHaveBeenCalledWith(stageApi);
    expect(result).toBe(expected);
  });

  it.each([undefined, null, {}])('handles boundary input %p', (input) => {
    const expected = { stageApi: input };
    shared.extractServices.mockReturnValueOnce(expected);

    const result = extractServices(input);

    expect(shared.extractServices).toHaveBeenCalledWith(input);
    expect(result).toBe(expected);
  });

  it('propagates errors from shared extractServices', () => {
    shared.extractServices.mockImplementation(() => {
      throw new Error('extract failed');
    });

    expect(() => extractServices({})).toThrow('extract failed');
  });
});

describe('mergeStageApis', () => {
  it('delegates to shared mergeStageApis with multiple apis', () => {
    const apiA = { emit: vi.fn() };
    const apiB = { signal: new AbortController().signal };
    const expected = { merged: true };
    shared.mergeStageApis.mockReturnValueOnce(expected);

    const result = mergeStageApis(apiA, apiB);

    expect(shared.mergeStageApis).toHaveBeenCalledWith(apiA, apiB);
    expect(result).toBe(expected);
  });

  it('passes through null, undefined, and empty array inputs', () => {
    const emptyArray = [];
    const expected = { merged: 'edge' };
    shared.mergeStageApis.mockReturnValueOnce(expected);

    const result = mergeStageApis(null, undefined, emptyArray);

    expect(shared.mergeStageApis).toHaveBeenCalledWith(null, undefined, emptyArray);
    expect(result).toBe(expected);
  });

  it('handles concurrent merge calls independently', async () => {
    let callIndex = 0;
    shared.mergeStageApis.mockImplementation((...apis) => ({ apis, index: callIndex++ }));

    const inputs = [
      [{ id: 1 }, { id: 2 }],
      [null],
      [{ id: 3, name: 'x' }],
    ];

    const results = await Promise.all(inputs.map((args) => Promise.resolve(mergeStageApis(...args))));

    expect(results.map((r) => r.index)).toEqual([0, 1, 2]);
    expect(results[0].apis).toEqual(inputs[0]);
    expect(results[1].apis).toEqual(inputs[1]);
    expect(results[2].apis).toEqual(inputs[2]);
    expect(shared.mergeStageApis).toHaveBeenCalledTimes(3);
  });

  it('propagates errors from shared mergeStageApis', () => {
    shared.mergeStageApis.mockImplementation(() => {
      throw new Error('merge failed');
    });

    expect(() => mergeStageApis({})).toThrow('merge failed');
  });
});

describe('createChildApi', () => {
  it('delegates to shared createChildApi with parent and overrides', () => {
    const parentApi = { emit: vi.fn() };
    const overrides = { logger: { warn: vi.fn() } };
    const expected = { child: true };
    shared.createChildApi.mockReturnValueOnce(expected);

    const result = createChildApi(parentApi, overrides);

    expect(shared.createChildApi).toHaveBeenCalledWith(parentApi, overrides);
    expect(result).toBe(expected);
  });

  it('uses default overrides when omitted', () => {
    const parentApi = { signal: new AbortController().signal };

    const result = createChildApi(parentApi);

    expect(shared.createChildApi).toHaveBeenCalledWith(parentApi, {});
    expect(result).toEqual({ parentApi, overrides: {} });
  });

  it('supports rapid successive calls', () => {
    shared.createChildApi.mockImplementation((parentApi, overrides) => ({ parentApi, overrides }));
    const parents = Array.from({ length: 50 }, (_, index) => ({ id: index }));

    const results = parents.map((parentApi) => createChildApi(parentApi, { idx: parentApi.id }));

    expect(shared.createChildApi).toHaveBeenCalledTimes(50);
    expect(results[0].overrides.idx).toBe(0);
    expect(results[49].overrides.idx).toBe(49);
  });

  it('propagates errors from shared createChildApi', () => {
    shared.createChildApi.mockImplementation(() => {
      throw new Error('child failed');
    });

    expect(() => createChildApi({})).toThrow('child failed');
  });
});
