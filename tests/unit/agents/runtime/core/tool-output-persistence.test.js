import { describe, it, expect, vi, beforeEach } from 'vitest';

const artifactMocks = vi.hoisted(() => ({
  computeSha256: vi.fn(),
}));

const sharedMocks = vi.hoisted(() => ({
  isPlainObject: vi.fn(),
}));

vi.mock('../../../../../js/agents/storage/artifact-manager.js', () => ({
  computeSha256: artifactMocks.computeSha256,
}));

vi.mock('../../../../../js/agents/shared/index.js', () => ({
  isPlainObject: sharedMocks.isPlainObject,
}));

import {
  maybePersistJsonArtifact,
  maybePersistToolOutput,
} from '../../../../../js/agents/runtime/core/tool-output-persistence.js';

const makeLongString = (length, char = 'a') => char.repeat(length);

const makeDeepObject = (depth) => {
  let obj = { leaf: 'end' };
  for (let i = 0; i < depth; i += 1) {
    obj = { level: i, child: obj };
  }
  return obj;
};

const makeRunStore = (prefix = 'artifact') => {
  let counter = 0;
  return {
    saveArtifact: vi.fn(async (_runId, _type, json) => `${prefix}-${json.length}-${++counter}`),
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  artifactMocks.computeSha256.mockImplementation(async (input) => `sha-${String(input).length}`);
  sharedMocks.isPlainObject.mockImplementation((value) => {
    if (!value || typeof value !== 'object') return false;
    return Object.getPrototypeOf(value) === Object.prototype;
  });
});

describe('maybePersistJsonArtifact', () => {
  it.each([
    ['null', null],
    ['empty string', ''],
    ['whitespace string', '   '],
    ['empty array', []],
    ['empty object', {}],
    ['zero', 0],
    ['negative one', -1],
    ['max safe integer', Number.MAX_SAFE_INTEGER],
  ])('returns inline data for small payloads (%s)', async (_label, value) => {
    const result = await maybePersistJsonArtifact({ data: value, maxInlineChars: 100 });

    expect(result.persisted).toBe(false);
    expect(result.inline).toBe(value);
    expect(artifactMocks.computeSha256).not.toHaveBeenCalled();
  });

  it('handles undefined data by returning a truncated preview when persistence is unavailable', async () => {
    const result = await maybePersistJsonArtifact({ data: undefined, maxInlineChars: 100 });

    expect(result.persisted).toBe(false);
    expect(result.inline.persisted).toBe(false);
    expect(result.inline.truncated).toBe(true);
    expect(result.inline.preview).toBe('');
    expect(result.inline.totalChars).toBeUndefined();
    expect(result.inline.note).toContain('persistence unavailable');
    expect(artifactMocks.computeSha256).not.toHaveBeenCalled();
  });

  it('returns preview for large payloads when persistence is unavailable and maxInlineChars is a string', async () => {
    const data = makeLongString(9000, 'x');

    const result = await maybePersistJsonArtifact({
      data,
      maxInlineChars: '10',
      previewChars: '40',
    });

    const jsonLength = JSON.stringify(data).length;

    expect(result.persisted).toBe(false);
    expect(result.inline.persisted).toBe(false);
    expect(result.inline.truncated).toBe(true);
    expect(result.inline.preview.endsWith('\n...(truncated)')).toBe(true);
    expect(result.inline.totalChars).toBe(jsonLength);
    expect(result.inline.note).toContain('Result too large');
  });

  it('persists large payloads with sha256 metadata when runStore is available', async () => {
    const data = {
      message: makeLongString(12000, 'a'),
      deep: makeDeepObject(12),
      items: { 0: 'a', length: 1 },
    };
    const json = JSON.stringify(data, null, 2);
    const runStore = {
      saveArtifact: vi.fn(async () => 'artifact-123'),
    };

    artifactMocks.computeSha256.mockResolvedValueOnce('hash-abc');

    const result = await maybePersistJsonArtifact({
      runStore,
      runId: 'run-1',
      type: 'custom.json',
      data,
      maxInlineChars: 50,
      previewChars: 40,
    });

    expect(runStore.saveArtifact).toHaveBeenCalledTimes(1);
    const [runIdArg, typeArg, jsonArg, metaArg] = runStore.saveArtifact.mock.calls[0];
    expect(runIdArg).toBe('run-1');
    expect(typeArg).toBe('custom.json');
    expect(jsonArg).toBe(json);
    expect(metaArg).toEqual(expect.objectContaining({
      mime: 'application/json',
      bytes: json.length,
      sha256: 'hash-abc',
    }));

    const stored = JSON.parse(jsonArg);
    expect(stored.items).toEqual({ 0: 'a', length: 1 });

    expect(result.persisted).toBe(true);
    expect(result.inline.persisted).toBe(true);
    expect(result.inline.artifactId).toBe('artifact-123');
    expect(result.inline.type).toBe('custom.json');
    expect(result.inline.bytes).toBe(json.length);
    expect(result.inline.sha256).toBe('hash-abc');
    expect(result.inline.preview.endsWith('\n...(truncated)')).toBe(true);
    expect(result.ref).toEqual({
      artifactId: 'artifact-123',
      type: 'custom.json',
      bytes: json.length,
      sha256: 'hash-abc',
    });
  });

  it('persists even when stringify or sha256 fails and omits sha256 metadata', async () => {
    const data = {};
    data.self = data;
    const runStore = {
      saveArtifact: vi.fn(async () => 'artifact-fail'),
    };

    artifactMocks.computeSha256.mockRejectedValueOnce(new Error('sha failed'));

    const result = await maybePersistJsonArtifact({
      runStore,
      runId: 'run-err',
      data,
      maxInlineChars: 0,
    });

    expect(runStore.saveArtifact).toHaveBeenCalledTimes(1);
    const jsonArg = runStore.saveArtifact.mock.calls[0][2];
    const metaArg = runStore.saveArtifact.mock.calls[0][3];
    expect(jsonArg).toContain('json_stringify_failed');
    expect(metaArg).toEqual(expect.objectContaining({
      mime: 'application/json',
      bytes: expect.any(Number),
    }));
    expect(Object.prototype.hasOwnProperty.call(metaArg, 'sha256')).toBe(false);

    expect(result.persisted).toBe(true);
    expect(result.inline).not.toHaveProperty('sha256');
    expect(result.ref.sha256).toBeUndefined();
  });

  it('supports concurrent persistence calls', async () => {
    const runStore = {
      saveArtifact: vi.fn(async (runId, type, json) => `${runId}-${type}-${json.length}`),
    };
    artifactMocks.computeSha256.mockImplementation(async (input) => `sha-${String(input).length}`);

    const [first, second] = await Promise.all([
      maybePersistJsonArtifact({
        runStore,
        runId: 'run-a',
        data: makeLongString(9001, 'a'),
        maxInlineChars: 10,
      }),
      maybePersistJsonArtifact({
        runStore,
        runId: 'run-b',
        data: makeLongString(9050, 'b'),
        maxInlineChars: 10,
      }),
    ]);

    expect(runStore.saveArtifact).toHaveBeenCalledTimes(2);
    expect(first.persisted).toBe(true);
    expect(second.persisted).toBe(true);

    const ids = new Set([first.inline.artifactId, second.inline.artifactId]);
    expect(ids.size).toBe(2);
  });
});

describe('maybePersistToolOutput', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['empty array', []],
    ['empty object', {}],
  ])('returns inline result for small payloads (%s)', async (_label, value) => {
    const result = await maybePersistToolOutput({
      toolName: 'tool',
      result: value,
    });

    expect(result.persisted).toBe(false);
    expect(result.inline).toBe(value);
    expect(artifactMocks.computeSha256).not.toHaveBeenCalled();
  });

  it('persists output, keeps args, and summarizes results with many keys', async () => {
    const runStore = {
      saveArtifact: vi.fn(async () => 'artifact-999'),
    };

    artifactMocks.computeSha256.mockResolvedValueOnce('hash-999');

    const resultPayload = { success: false, error: 'boom' };
    for (let i = 0; i < 22; i += 1) {
      resultPayload[`k${i}`] = i;
    }

    const response = await maybePersistToolOutput({
      runStore,
      runId: 'run-x',
      toolName: '   ',
      args: { mode: 'fast' },
      iteration: Number.MAX_SAFE_INTEGER,
      result: resultPayload,
      maxInlineChars: 1,
      previewChars: 30,
    });

    expect(sharedMocks.isPlainObject).toHaveBeenCalledWith({ mode: 'fast' });
    expect(runStore.saveArtifact).toHaveBeenCalledTimes(1);

    const [runIdArg, typeArg, jsonArg, metaArg] = runStore.saveArtifact.mock.calls[0];
    const envelope = JSON.parse(jsonArg);

    expect(runIdArg).toBe('run-x');
    expect(typeArg).toBe('tool_output.json');
    expect(envelope.schemaVersion).toBe('0.1');
    expect(envelope.kind).toBe('tool_output');
    expect(envelope.tool).toBe('   ');
    expect(envelope.iteration).toBe(Number.MAX_SAFE_INTEGER);
    expect(envelope.args).toEqual({ mode: 'fast' });
    expect(envelope.result).toEqual(resultPayload);

    expect(metaArg).toEqual(expect.objectContaining({
      sha256: 'hash-999',
      mime: 'application/json',
      bytes: expect.any(Number),
    }));

    expect(response.persisted).toBe(true);
    expect(response.inline.tool).toBe('   ');
    expect(response.inline.persistedOutput.artifactId).toBe('artifact-999');
    expect(response.inline.persistedOutput.type).toBe('tool_output.json');
    expect(response.inline.persistedOutput.bytes).toBe(metaArg.bytes);
    expect(response.inline.persistedOutput.sha256).toBe('hash-999');

    const summary = response.inline.summary;
    expect(summary.success).toBe(false);
    expect(summary.error).toBe('boom');
    expect(summary.keys).toHaveLength(20);
    expect(summary.moreKeys).toBe(Object.keys(resultPayload).length - 20);
  });

  it('skips args when treated as non-plain and ignores string iteration values', async () => {
    sharedMocks.isPlainObject.mockReturnValueOnce(false);

    const runStore = {
      saveArtifact: vi.fn(async () => 'artifact-args'),
    };

    const response = await maybePersistToolOutput({
      runStore,
      runId: 'run-args',
      toolName: 'tool',
      args: { 0: 'a' },
      iteration: '2',
      result: [1, 2],
      maxInlineChars: 1,
    });

    const envelope = JSON.parse(runStore.saveArtifact.mock.calls[0][2]);
    expect(envelope.args).toBeUndefined();
    expect(envelope.iteration).toBeUndefined();
    expect(response.inline.summary.keys).toEqual(['0', '1']);
  });

  it('handles quick consecutive persisted calls with mixed result types', async () => {
    const runStore = makeRunStore('seq');
    const inputs = [
      { result: 0, expected: { kind: 'number', value: '0' } },
      { result: 'ok', expected: { kind: 'string', value: 'ok' } },
      { result: null, expected: { kind: 'null' } },
    ];

    const outputs = [];
    for (const input of inputs) {
      const output = await maybePersistToolOutput({
        runStore,
        runId: 'run-seq',
        toolName: 'tool',
        result: input.result,
        maxInlineChars: 0,
      });
      outputs.push(output);
      expect(output.persisted).toBe(true);
      expect(output.inline.summary).toEqual(expect.objectContaining(input.expected));
    }

    expect(runStore.saveArtifact).toHaveBeenCalledTimes(inputs.length);
    const ids = new Set(outputs.map((output) => output.inline.persistedOutput.artifactId));
    expect(ids.size).toBe(outputs.length);
  });
});
