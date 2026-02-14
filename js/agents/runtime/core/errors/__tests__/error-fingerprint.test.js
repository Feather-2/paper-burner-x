import { describe, it } from 'node:test';
import assert from 'node:assert';
import { computeErrorFingerprint, normalizeMessage, extractTopFrames } from '../error-fingerprint.js';
import { classifyError, ErrorTaxonomy } from '../error-taxonomy.js';
import { ErrorAggregator } from '../error-aggregator.js';

describe('error-fingerprint', () => {
  it('produces stable fingerprint for same error', () => {
    const err = new TypeError('Cannot read property x of undefined');
    const fp1 = computeErrorFingerprint(err);
    const fp2 = computeErrorFingerprint(err);
    assert.strictEqual(fp1, fp2);
    assert.strictEqual(fp1.length, 16);
  });

  it('produces different fingerprints for different errors', () => {
    const e1 = new Error('foo');
    const e2 = new Error('bar');
    assert.notStrictEqual(computeErrorFingerprint(e1), computeErrorFingerprint(e2));
  });

  it('normalizes UUIDs and timestamps', () => {
    const m1 = normalizeMessage('Request 550e8400-e29b-41d4-a716-446655440000 failed at 1700000000000');
    const m2 = normalizeMessage('Request 660e8400-e29b-41d4-a716-556655440000 failed at 1700000001000');
    assert.strictEqual(m1, m2);
  });

  it('normalizes absolute paths', () => {
    const m = normalizeMessage('Error in /home/user/project/src/index.js:42');
    assert.ok(m.includes('<path>'));
    assert.ok(!m.includes('/home/user'));
  });

  it('extracts top stack frames', () => {
    const stack = `Error: test
    at foo (/a/b/c.js:1:2)
    at bar (/a/b/d.js:3:4)
    at baz (/a/b/e.js:5:6)
    at qux (/a/b/f.js:7:8)`;
    const frames = extractTopFrames(stack, 3);
    const lines = frames.split('\n');
    assert.strictEqual(lines.length, 3);
  });

  it('handles non-Error input', () => {
    const fp = computeErrorFingerprint('string error');
    assert.strictEqual(typeof fp, 'string');
    assert.strictEqual(fp.length, 16);
  });
});

describe('error-taxonomy', () => {
  it('classifies timeout errors', () => {
    const err = new Error('Request timeout');
    err.name = 'AbortError';
    assert.strictEqual(classifyError(err).taxonomy, ErrorTaxonomy.TIMEOUT);
    assert.strictEqual(classifyError(err).retryable, true);
  });

  it('classifies 429 as retryable', () => {
    const err = Object.assign(new Error('Too many requests'), { status: 429 });
    assert.strictEqual(classifyError(err).taxonomy, ErrorTaxonomy.RETRYABLE);
  });

  it('classifies network errors as retryable', () => {
    const err = Object.assign(new Error('connect'), { code: 'ECONNRESET' });
    assert.strictEqual(classifyError(err).taxonomy, ErrorTaxonomy.RETRYABLE);
  });

  it('classifies 4xx as non-retryable', () => {
    const err = Object.assign(new Error('Not found'), { status: 404 });
    assert.strictEqual(classifyError(err).taxonomy, ErrorTaxonomy.NON_RETRYABLE);
  });

  it('classifies TypeError as input validation', () => {
    const err = new TypeError('x is not a function');
    assert.strictEqual(classifyError(err).taxonomy, ErrorTaxonomy.INPUT_VALIDATION);
  });

  it('classifies OOM as resource exhaustion', () => {
    const err = new Error('JavaScript heap out of memory');
    assert.strictEqual(classifyError(err).taxonomy, ErrorTaxonomy.RESOURCE_EXHAUSTION);
  });

  it('respects explicit retryable/category', () => {
    const err = Object.assign(new Error('custom'), { retryable: true, category: 'custom_cat' });
    const result = classifyError(err);
    assert.strictEqual(result.taxonomy, 'custom_cat');
    assert.strictEqual(result.retryable, true);
  });
});

describe('ErrorAggregator', () => {
  it('aggregates same errors', () => {
    const agg = new ErrorAggregator();
    const e = new Error('test');
    agg.record(e, { runId: 'r1' });
    agg.record(e, { runId: 'r2' });
    const stats = agg.getStats();
    assert.strictEqual(stats.length, 1);
    assert.strictEqual(stats[0].count, 2);
    assert.strictEqual(stats[0].affectedRunCount, 2);
  });

  it('separates different errors', () => {
    const agg = new ErrorAggregator();
    agg.record(new Error('foo'));
    agg.record(new TypeError('bar'));
    assert.strictEqual(agg.size, 2);
  });

  it('getTopErrors returns sorted by count', () => {
    const agg = new ErrorAggregator();
    const e1 = new Error('rare');
    const e2 = new Error('common');
    agg.record(e1);
    agg.record(e2);
    agg.record(e2);
    agg.record(e2);
    const top = agg.getTopErrors(1);
    assert.strictEqual(top.length, 1);
    assert.strictEqual(top[0].count, 3);
  });

  it('reset clears all', () => {
    const agg = new ErrorAggregator();
    agg.record(new Error('x'));
    agg.reset();
    assert.strictEqual(agg.size, 0);
  });
});
