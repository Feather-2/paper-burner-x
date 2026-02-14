import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SourceMapRegistry, getAsyncWrapperOffset, getSyncWrapperOffset } from '../source-map-support.js';

describe('SourceMapRegistry', () => {
  it('maps position with line offset', () => {
    const reg = new SourceMapRegistry();
    reg.register('test.js', 'console.log("hi")', 2);
    const mapped = reg.mapPosition('test.js', 5);
    assert.strictEqual(mapped.line, 3);
  });

  it('clamps mapped line to minimum 1', () => {
    const reg = new SourceMapRegistry();
    reg.register('test.js', 'x', 10);
    const mapped = reg.mapPosition('test.js', 2);
    assert.strictEqual(mapped.line, 1);
  });

  it('returns null for unregistered script', () => {
    const reg = new SourceMapRegistry();
    assert.strictEqual(reg.mapPosition('unknown.js', 5), null);
  });

  it('maps stack trace lines', () => {
    const reg = new SourceMapRegistry();
    reg.register('<sandbox>', 'code', 2);
    const stack = `Error: test
    at foo (<sandbox>:5:10)
    at bar (<sandbox>:8)`;
    const mapped = reg.mapStackTrace(stack, '<sandbox>');
    assert.ok(mapped.includes(':3:10'));
    assert.ok(mapped.includes(':6'));
  });

  it('preserves non-frame lines', () => {
    const reg = new SourceMapRegistry();
    reg.register('s', 'c', 1);
    const stack = 'Error: boom\n  some random text';
    const mapped = reg.mapStackTrace(stack, 's');
    assert.ok(mapped.includes('Error: boom'));
    assert.ok(mapped.includes('some random text'));
  });

  it('remove and clear work', () => {
    const reg = new SourceMapRegistry();
    reg.register('a', 'x', 1);
    reg.register('b', 'y', 2);
    assert.strictEqual(reg.size, 2);
    reg.remove('a');
    assert.strictEqual(reg.size, 1);
    reg.clear();
    assert.strictEqual(reg.size, 0);
  });
});

describe('wrapper offsets', () => {
  it('async wrapper offset is 2', () => {
    assert.strictEqual(getAsyncWrapperOffset(), 2);
  });

  it('sync wrapper offset is 0', () => {
    assert.strictEqual(getSyncWrapperOffset(), 0);
  });
});
