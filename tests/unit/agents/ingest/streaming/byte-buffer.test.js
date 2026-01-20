import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

import { ByteBuffer } from '../../../../../js/agents/ingest/streaming/byte-buffer.js';

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'mock-uuid'),
}));

describe('ByteBuffer', () => {
  let buffer;

  beforeEach(() => {
    buffer = new ByteBuffer();
    vi.clearAllMocks();
  });

  it('constructs with initial data and supports basic append/slice', () => {
    const seeded = new ByteBuffer([1, 2, 3]);

    expect(seeded.length).toBe(3);
    expect(seeded.slice()).toEqual(Uint8Array.from([1, 2, 3]));

    const result = buffer.append([4, 5]).append([6]);

    expect(result).toBe(buffer);
    expect(buffer.length).toBe(3);
    expect(buffer.slice()).toEqual(Uint8Array.from([4, 5, 6]));
  });

  it('accepts Uint8Array, ArrayBuffer, and ArrayBufferView inputs', () => {
    const arrayBuffer = new Uint8Array([2, 3]).buffer;
    const viewSource = new Uint8Array([0, 4, 5, 6]);
    const view = new DataView(viewSource.buffer, 1, 2);

    buffer
      .append(new Uint8Array([1]))
      .append(arrayBuffer)
      .append(view)
      .append([6, 7]);

    expect(buffer.slice()).toEqual(Uint8Array.from([1, 2, 3, 4, 5, 6, 7]));
  });

  it('ignores empty array input and handles empty buffer behaviors', () => {
    const result = buffer.append([]);

    expect(result).toBe(buffer);
    expect(buffer.length).toBe(0);
    expect(buffer.slice()).toEqual(new Uint8Array(0));
    expect(buffer.indexOf([1])).toBe(-1);
    expect(buffer.indexOf([])).toBe(0);
  });

  it('slice supports negative indices, string numbers, MAX_SAFE_INTEGER, and whitespace', () => {
    buffer.append([1, 2, 3, 4, 5]);

    expect(buffer.slice(-1)).toEqual(Uint8Array.from([5]));
    expect(buffer.slice(0, -1)).toEqual(Uint8Array.from([1, 2, 3, 4]));
    expect(buffer.slice(0, 0)).toEqual(new Uint8Array(0));
    expect(buffer.slice('1', '3')).toEqual(Uint8Array.from([2, 3]));
    expect(buffer.slice('   ', '2')).toEqual(Uint8Array.from([1, 2]));
    expect(buffer.slice(0, Number.MAX_SAFE_INTEGER)).toEqual(Uint8Array.from([1, 2, 3, 4, 5]));
    expect(buffer.slice(Number.MAX_SAFE_INTEGER)).toEqual(new Uint8Array(0));
  });

  it('indexOf finds needles with fromIndex boundaries', () => {
    buffer.append([1, 2, 3, 2, 3, 4]);

    expect(buffer.indexOf([2, 3])).toBe(1);
    expect(buffer.indexOf([2, 3], 2)).toBe(3);
    expect(buffer.indexOf([2, 3], -3)).toBe(3);
    expect(buffer.indexOf([2, 3], '2')).toBe(3);
  });

  it('indexOf returns -1 for missing or out-of-range needles', () => {
    buffer.append([1, 2]);

    expect(buffer.indexOf([3])).toBe(-1);
    expect(buffer.indexOf([1, 2, 3])).toBe(-1);
    expect(buffer.indexOf([1], Number.MAX_SAFE_INTEGER)).toBe(-1);
  });

  it('consume drops bytes and handles numeric string/negative/whitespace', () => {
    buffer.append([1, 2, 3, 4]);

    buffer.consume('2');
    expect(buffer.slice()).toEqual(Uint8Array.from([3, 4]));

    buffer.consume(-1);
    expect(buffer.slice()).toEqual(Uint8Array.from([3, 4]));

    buffer.consume('   ');
    expect(buffer.slice()).toEqual(Uint8Array.from([3, 4]));

    buffer.consume(0);
    expect(buffer.slice()).toEqual(Uint8Array.from([3, 4]));

    buffer.consume(Number.MAX_SAFE_INTEGER);
    expect(buffer.length).toBe(0);
    expect(buffer.slice()).toEqual(new Uint8Array(0));
  });

  it('append after consume preserves order when compacting', () => {
    const first = new Uint8Array(200);
    first.fill(1);
    buffer.append(first);
    buffer.consume(150);

    const second = new Uint8Array(150);
    second.fill(2);
    buffer.append(second);

    expect(buffer.length).toBe(200);
    expect(Array.from(buffer.slice(0, 2))).toEqual([1, 1]);
    expect(Array.from(buffer.slice(buffer.length - 2))).toEqual([2, 2]);
  });

  it('rejects invalid input types for append and indexOf', () => {
    const longString = randomUUID().repeat(500);

    expect(randomUUID).toHaveBeenCalledTimes(1);

    const invalidInputs = [null, undefined, '', longString, {}, { 0: 1, length: 1 }];

    for (const input of invalidInputs) {
      expect(() => buffer.append(input)).toThrow(TypeError);
    }

    for (const input of invalidInputs) {
      expect(() => buffer.indexOf(input)).toThrow(TypeError);
    }
  });

  it('handles large buffers and deep nested arrays', () => {
    const size = 1024 * 1024 + 7;
    const large = new Uint8Array(size);
    for (let i = 0; i < size; i += 1) {
      large[i] = i % 256;
    }

    buffer.append(large);

    expect(buffer.length).toBe(size);
    expect(buffer.slice(0, 3)).toEqual(Uint8Array.from([0, 1, 2]));
    expect(Array.from(buffer.slice(size - 3))).toEqual([
      (size - 3) % 256,
      (size - 2) % 256,
      (size - 1) % 256,
    ]);

    const nestedBuffer = new ByteBuffer();
    nestedBuffer.append([[[7]]]);
    expect(nestedBuffer.slice()).toEqual(Uint8Array.from([7]));
  });

  it('supports quick consecutive appends', () => {
    for (let i = 0; i < 50; i += 1) {
      buffer.append([i % 256]);
    }

    expect(buffer.length).toBe(50);
    expect(buffer.slice(0, 3)).toEqual(Uint8Array.from([0, 1, 2]));
    expect(buffer.slice(-3)).toEqual(Uint8Array.from([47, 48, 49]));
  });

  it('supports scheduled concurrent appends', async () => {
    const chunks = [[1, 2], [3, 4], [5]];

    await Promise.all(
      chunks.map((chunk) => Promise.resolve().then(() => buffer.append(chunk))),
    );

    expect(buffer.slice()).toEqual(Uint8Array.from([1, 2, 3, 4, 5]));
  });
});
