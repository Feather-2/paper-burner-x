import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}));

import transports, {
  BinarySkillProvider,
  ProcessTransport,
  createBinarySkillProvider,
  createProcessTransport,
} from '../../../../../js/agents/plugins/transports/index.browser.js';

const expectedError = (name) => `${name} is not available in browser runtimes.`;

const buildDeepNested = (depth) => {
  let root = {};
  let cursor = root;
  for (let i = 0; i < depth; i += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  return root;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ProcessTransport', () => {
  it('throws with no arguments', () => {
    expect(() => new ProcessTransport()).toThrowError(expectedError('ProcessTransport'));
  });

  it('throws for empty and nullish inputs', () => {
    const inputs = [null, undefined, '', [], {}];

    for (const input of inputs) {
      expect(() => new ProcessTransport(input)).toThrowError(expectedError('ProcessTransport'));
    }
  });
});

describe('createProcessTransport', () => {
  it('throws with no arguments', () => {
    expect(() => createProcessTransport()).toThrowError(
      expectedError('createProcessTransport'),
    );
  });

  it('throws for numeric boundary values', () => {
    const inputs = [0, -1, Number.MAX_SAFE_INTEGER];

    for (const input of inputs) {
      expect(() => createProcessTransport(input)).toThrowError(
        expectedError('createProcessTransport'),
      );
    }
  });

  it('throws during rapid successive calls', () => {
    for (let i = 0; i < 5; i += 1) {
      expect(() => createProcessTransport(`call-${i}`)).toThrowError(
        expectedError('createProcessTransport'),
      );
    }
  });
});

describe('BinarySkillProvider', () => {
  it('throws with no arguments', () => {
    expect(() => new BinarySkillProvider()).toThrowError(
      expectedError('BinarySkillProvider'),
    );
  });

  it('throws for resource boundary inputs', () => {
    const longString = 'a'.repeat(100000);
    const largeBinary = new Uint8Array(1024 * 1024);
    const deepNested = buildDeepNested(64);
    const inputs = [longString, largeBinary, deepNested, '   '];

    for (const input of inputs) {
      expect(() => new BinarySkillProvider(input)).toThrowError(
        expectedError('BinarySkillProvider'),
      );
    }
  });
});

describe('createBinarySkillProvider', () => {
  it('throws with no arguments', () => {
    expect(() => createBinarySkillProvider()).toThrowError(
      expectedError('createBinarySkillProvider'),
    );
  });

  it('throws for type boundary inputs', () => {
    const arrayLike = { 0: 'value', length: 1 };
    const inputs = ['123', arrayLike];

    for (const input of inputs) {
      expect(() => createBinarySkillProvider(input)).toThrowError(
        expectedError('createBinarySkillProvider'),
      );
    }
  });

  it('rejects concurrent calls', async () => {
    const calls = Array.from({ length: 5 }, (_, index) =>
      Promise.resolve().then(() => createBinarySkillProvider(`call-${index}`)),
    );

    const results = await Promise.allSettled(calls);

    expect(results).toHaveLength(5);

    for (const result of results) {
      expect(result.status).toBe('rejected');
      expect(result.reason).toBeInstanceOf(Error);
      expect(result.reason.message).toBe(expectedError('createBinarySkillProvider'));
    }
  });
});

describe('default export', () => {
  it('exposes the expected members', () => {
    const keys = Object.keys(transports).sort();

    expect(keys).toEqual([
      'BinarySkillProvider',
      'ProcessTransport',
      'createBinarySkillProvider',
      'createProcessTransport',
    ]);
    expect(transports.ProcessTransport).toBe(ProcessTransport);
    expect(transports.createProcessTransport).toBe(createProcessTransport);
    expect(transports.BinarySkillProvider).toBe(BinarySkillProvider);
    expect(transports.createBinarySkillProvider).toBe(createBinarySkillProvider);
  });
});
