import { describe, it, expect } from 'vitest';
import {
  randomBytes, randomUUID, randomInt, createHash, createHmac, pbkdf2Sync,
  createSign, createVerify, wrapKey,
} from '../../../../../../js/agents/core/sandbox/shims/crypto.js';
import { Buffer } from '../../../../../../js/agents/core/sandbox/shims/buffer.js';

describe('crypto shim', () => {
  it('randomBytes returns Buffer', () => {
    const buf = randomBytes(16);
    expect(Buffer.isBuffer(buf)).toBe(true);
  });

  it('randomBytes(16).length === 16', () => {
    expect(randomBytes(16).length).toBe(16);
  });

  it('randomUUID returns valid UUID format', () => {
    const uuid = randomUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it('randomInt returns integer in range', () => {
    for (let i = 0; i < 20; i++) {
      const val = randomInt(5, 10);
      expect(val).toBeGreaterThanOrEqual(5);
      expect(val).toBeLessThan(10);
      expect(Number.isInteger(val)).toBe(true);
    }
  });

  it('randomInt with single arg uses 0 as min', () => {
    for (let i = 0; i < 20; i++) {
      const val = randomInt(5);
      expect(val).toBeGreaterThanOrEqual(0);
      expect(val).toBeLessThan(5);
    }
  });

  it('createHash(sha256).update(hello).digest(hex) returns non-empty hex', () => {
    const hex = createHash('sha256').update('hello').digest('hex');
    expect(typeof hex).toBe('string');
    expect(hex.length).toBeGreaterThan(0);
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });

  it('createHash returns chainable update', () => {
    const hash = createHash('sha256');
    const ret = hash.update('a');
    expect(ret).toBe(hash);
    ret.update('b');
    const hex = ret.digest('hex');
    expect(hex.length).toBeGreaterThan(0);
  });

  it('createHmac(sha256, key).update(data).digest(hex) returns non-empty hex', () => {
    const hex = createHmac('sha256', 'secret').update('data').digest('hex');
    expect(typeof hex).toBe('string');
    expect(hex.length).toBeGreaterThan(0);
    expect(hex).toMatch(/^[0-9a-f]+$/);
  });

  it('Hash.digest(base64) returns valid base64', () => {
    const b64 = createHash('sha256').update('test').digest('base64');
    expect(typeof b64).toBe('string');
    expect(b64.length).toBeGreaterThan(0);
    expect(b64).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('pbkdf2Sync returns Buffer', () => {
    const key = pbkdf2Sync('password', 'salt', 1, 32, 'sha256');
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
  });

  it('Buffer.isBuffer(randomBytes(4)) === true', () => {
    expect(Buffer.isBuffer(randomBytes(4))).toBe(true);
  });
});

describe('crypto sign/verify', () => {
  it('createSign returns object with update and sign', () => {
    const signer = createSign('sha256');
    expect(typeof signer.update).toBe('function');
    expect(typeof signer.sign).toBe('function');
  });

  it('createVerify returns object with update and verify', () => {
    const verifier = createVerify('sha256');
    expect(typeof verifier.update).toBe('function');
    expect(typeof verifier.verify).toBe('function');
  });

  it('Sign.update is chainable', () => {
    const signer = createSign('sha256');
    expect(signer.update('data')).toBe(signer);
  });

  it('Verify.update is chainable', () => {
    const verifier = createVerify('sha256');
    expect(verifier.update('data')).toBe(verifier);
  });

  it('wrapKey wraps a key with algorithm', () => {
    const fakeKey = {};
    const wrapped = wrapKey(fakeKey, { name: 'ECDSA', namedCurve: 'P-256' });
    expect(wrapped._wcKey).toBe(fakeKey);
    expect(wrapped._wcAlg.name).toBe('ECDSA');
  });

  it('Sign.sign rejects without wrapped key', async () => {
    const signer = createSign('sha256').update('test');
    await expect(signer.sign('invalid-key')).rejects.toThrow('requires a CryptoKey');
  });
});
