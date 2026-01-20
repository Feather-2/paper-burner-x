import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';

import {
  cryptoRandomHex,
  cryptoRandomUuid,
  makeSecureId,
  makeSecureTimestampedId,
} from '../../../../../js/agents/shared/utils/secure-id.js';

vi.mock('node:crypto', () => ({
  webcrypto: {
    getRandomValues: vi.fn(),
    randomUUID: vi.fn(),
  },
}));

const HEX_REGEX = /^[0-9a-f]+$/;
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();

  let byteCounter = 0;
  let uuidCounter = 0;

  webcrypto.getRandomValues = vi.fn((buf) => {
    for (let i = 0; i < buf.length; i += 1) {
      buf[i] = (byteCounter + i) % 256;
    }
    byteCounter += buf.length;
    return buf;
  });

  webcrypto.randomUUID = vi.fn(() => {
    uuidCounter += 1;
    return `00000000-0000-4000-8000-${uuidCounter.toString(16).padStart(12, '0')}`;
  });

  vi.stubGlobal('crypto', webcrypto);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('shared/utils/secure-id', () => {
  describe('cryptoRandomHex', () => {
    it('returns lower-case hex for the default length', () => {
      const hex = cryptoRandomHex();

      expect(hex).toHaveLength(32);
      expect(hex).toMatch(HEX_REGEX);
      expect(webcrypto.getRandomValues).toHaveBeenCalledTimes(1);
      const [buf] = webcrypto.getRandomValues.mock.calls[0];
      expect(buf).toBeInstanceOf(Uint8Array);
      expect(buf.length).toBe(16);
    });

    it.each([
      ['zero', 0],
      ['negative', -1],
    ])('clamps byte length for %s inputs', (_label, input) => {
      const hex = cryptoRandomHex(input);

      expect(hex).toHaveLength(2);
      expect(hex).toMatch(HEX_REGEX);
    });

    it.each([
      ['null', null],
      ['undefined', undefined],
      ['empty string', ''],
      ['whitespace string', '   '],
      ['numeric string', '8'],
      ['empty array', []],
      ['empty object', {}],
      ['array-like object', { 0: 'x', length: 1 }],
      ['deep nested', [[[[[]]]]]],
    ])('falls back to default length for %s', (_label, input) => {
      const hex = cryptoRandomHex(input);

      expect(hex).toHaveLength(32);
      expect(hex).toMatch(HEX_REGEX);
    });

    it('handles large byte counts for resource-boundary inputs', () => {
      const size = 1024 * 1024;
      webcrypto.getRandomValues = vi.fn((buf) => {
        buf.fill(0xab);
        return buf;
      });
      vi.stubGlobal('crypto', webcrypto);

      const hex = cryptoRandomHex(size);

      expect(hex.length).toBe(size * 2);
      expect(hex.slice(0, 4)).toBe('abab');
      expect(hex.slice(-4)).toBe('abab');
    });

    it('throws when globalThis.crypto is unavailable', () => {
      vi.stubGlobal('crypto', undefined);

      expect(() => cryptoRandomHex()).toThrow(
        'secure-id: globalThis.crypto is unavailable in this environment',
      );
    });

    it('throws when crypto.getRandomValues is unavailable', () => {
      vi.stubGlobal('crypto', { randomUUID: webcrypto.randomUUID });

      expect(() => cryptoRandomHex()).toThrow(
        'secure-id: crypto.getRandomValues is unavailable in this environment',
      );
    });
  });

  describe('cryptoRandomUuid', () => {
    it('uses crypto.randomUUID when available', () => {
      webcrypto.randomUUID = vi.fn(() => 'mock-uuid');
      vi.stubGlobal('crypto', webcrypto);

      const uuid = cryptoRandomUuid();

      expect(uuid).toBe('mock-uuid');
      expect(webcrypto.randomUUID).toHaveBeenCalledTimes(1);
      expect(webcrypto.getRandomValues).not.toHaveBeenCalled();
    });

    it('falls back to v4-ish format when randomUUID is unavailable', () => {
      webcrypto.randomUUID = undefined;
      webcrypto.getRandomValues = vi.fn((buf) => {
        buf.fill(0);
        return buf;
      });
      vi.stubGlobal('crypto', webcrypto);

      const uuid = cryptoRandomUuid();

      expect(uuid).toBe('00000000-0000-4000-a000-000000000000');
      expect(uuid).toMatch(UUID_V4_REGEX);
      expect(webcrypto.getRandomValues).toHaveBeenCalledTimes(1);
      const [buf] = webcrypto.getRandomValues.mock.calls[0];
      expect(buf.length).toBe(16);
    });

    it('throws when globalThis.crypto is unavailable', () => {
      vi.stubGlobal('crypto', undefined);

      expect(() => cryptoRandomUuid()).toThrow(
        'secure-id: globalThis.crypto is unavailable in this environment',
      );
    });
  });

  describe('makeSecureId', () => {
    it('uses trimmed prefix with the random UUID', () => {
      webcrypto.randomUUID = vi.fn(() => 'mock-uuid');
      vi.stubGlobal('crypto', webcrypto);

      const id = makeSecureId('  session  ');

      expect(id).toBe('session_mock-uuid');
    });

    it.each([
      ['null', null],
      ['empty string', ''],
      ['whitespace string', '   '],
      ['empty array', []],
      ['empty object', {}],
      ['array-like object', { 0: 'x', length: 1 }],
      ['max safe int', Number.MAX_SAFE_INTEGER],
      ['deep nested', [[[[{}]]]]],
    ])('uses default prefix for %s', (_label, input) => {
      const id = makeSecureId(input);

      expect(id.startsWith('id_')).toBe(true);
    });

    it('handles very long prefix strings', () => {
      const prefix = 'x'.repeat(10_000);
      webcrypto.randomUUID = vi.fn(() => 'mock-uuid');
      vi.stubGlobal('crypto', webcrypto);

      const id = makeSecureId(prefix);

      expect(id.startsWith(`${prefix}_`)).toBe(true);
      expect(id.length).toBe(prefix.length + 1 + 'mock-uuid'.length);
    });

    it('handles simultaneous calls without collisions', async () => {
      let counter = 0;
      webcrypto.randomUUID = vi.fn(() => {
        counter += 1;
        return `00000000-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`;
      });
      vi.stubGlobal('crypto', webcrypto);

      const results = await Promise.all(
        Array.from({ length: 10 }, () => Promise.resolve().then(() => makeSecureId('job'))),
      );

      expect(new Set(results).size).toBe(results.length);
      for (const id of results) {
        expect(id.startsWith('job_')).toBe(true);
      }
    });

    it('throws when globalThis.crypto is unavailable', () => {
      vi.stubGlobal('crypto', undefined);

      expect(() => makeSecureId('job')).toThrow(
        'secure-id: globalThis.crypto is unavailable in this environment',
      );
    });
  });

  describe('makeSecureTimestampedId', () => {
    it('includes prefix, base36 timestamp, and random hex', () => {
      const fixedTime = new Date('2024-01-02T03:04:05.000Z');
      vi.useFakeTimers();
      vi.setSystemTime(fixedTime);
      webcrypto.getRandomValues = vi.fn((buf) => {
        buf.fill(0xaa);
        return buf;
      });
      vi.stubGlobal('crypto', webcrypto);

      const id = makeSecureTimestampedId('run');
      const expectedTimestamp = fixedTime.getTime().toString(36);

      expect(id).toBe(`run_${expectedTimestamp}_${'aa'.repeat(8)}`);
    });

    it.each([
      ['undefined', undefined],
      ['whitespace string', '   '],
    ])('uses the default prefix for %s', (_label, input) => {
      const id = makeSecureTimestampedId(input);

      expect(id.startsWith('id_')).toBe(true);
    });

    it('handles rapid sequential calls within the same millisecond', () => {
      const fixedTime = new Date('2024-01-02T03:04:05.000Z');
      vi.useFakeTimers();
      vi.setSystemTime(fixedTime);
      let seed = 1;
      webcrypto.getRandomValues = vi.fn((buf) => {
        buf.fill(seed);
        seed = (seed + 1) % 256;
        return buf;
      });
      vi.stubGlobal('crypto', webcrypto);

      const ids = Array.from({ length: 5 }, () => makeSecureTimestampedId('seq'));
      const timestamps = ids.map((id) => id.split('_')[1]);

      expect(new Set(timestamps).size).toBe(1);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('throws when crypto.getRandomValues is unavailable', () => {
      vi.stubGlobal('crypto', { randomUUID: webcrypto.randomUUID });

      expect(() => makeSecureTimestampedId('oops')).toThrow(
        'secure-id: crypto.getRandomValues is unavailable in this environment',
      );
    });
  });
});
