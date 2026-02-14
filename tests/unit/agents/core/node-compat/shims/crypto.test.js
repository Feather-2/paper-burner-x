import { describe, it, expect } from 'vitest';
import {
  randomBytes, randomUUID, randomInt, createHash, createHmac, pbkdf2Sync,
  createSign, createVerify, wrapKey,
} from '../../../../../../js/agents/core/node-compat/shims/crypto.js';
import { Buffer } from '../../../../../../js/agents/core/node-compat/shims/buffer.js';

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

  it('Hash.digest throws with migration guidance', () => {
    expect(() => createHash('sha256').update('hello').digest('hex')).toThrow(
      '[crypto shim] Hash.digest() is not supported in browser environment. ' +
      'Synchronous hashing cannot be implemented securely without Web Crypto API. ' +
      'Use digestAsync() instead for cryptographically correct results.'
    );
  });

  it('createHash(sha256).update(hello).digestAsync(hex) returns SHA-256', async () => {
    const hex = await createHash('sha256').update('hello').digestAsync('hex');
    expect(hex).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('createHash returns chainable update', async () => {
    const hash = createHash('sha256');
    const ret = hash.update('a');
    expect(ret).toBe(hash);
    ret.update('b');
    const hex = await ret.digestAsync('hex');
    expect(hex).toBe('fb8e20fc2e4c3f248c60c39bd652f3c1347298bb977b8b4d5903b85055620603');
  });

  it('Hmac.digest throws with migration guidance', () => {
    expect(() => createHmac('sha256', 'secret').update('data').digest('hex')).toThrow(
      '[crypto shim] Hmac.digest() is not supported in browser environment. ' +
      'Synchronous HMAC cannot be implemented securely without Web Crypto API. ' +
      'Use digestAsync() instead for cryptographically correct results.'
    );
  });

  it('createHmac(sha256, key).update(data).digestAsync(hex) returns HMAC', async () => {
    const hex = await createHmac('sha256', 'secret').update('data').digestAsync('hex');
    expect(hex).toBe('1b2c16b75bd2a870c114153ccda5bcfca63314bc722fa160d690de133ccbb9db');
  });

  it('Hash.digestAsync(base64) returns valid base64', async () => {
    const b64 = await createHash('sha256').update('test').digestAsync('base64');
    expect(b64).toBe('n4bQgYhMfWWaL+qgxVrQFaO/TxsrC4Is0V1sFbDwCgg=');
  });

  it('pbkdf2Sync throws with migration guidance', () => {
    expect(() => pbkdf2Sync('password', 'salt', 1, 32, 'sha256')).toThrow(
      '[crypto shim] pbkdf2Sync() is not supported in browser environment'
    );
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
