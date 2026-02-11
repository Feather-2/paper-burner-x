import { describe, it, expect, vi } from 'vitest';
import {
  validateDomainPattern,
  matchesDomainPattern,
  isUrlAllowed,
  isUrlAllowedAsync,
  validateNetworkPolicy,
} from '../../../../../js/agents/core/sandbox/network-policy-utils.js';

describe('network-policy-utils', () => {
  describe('validateDomainPattern', () => {
    it('accepts plain domain', () => {
      expect(() => validateDomainPattern('api.example.com')).not.toThrow();
    });

    it('accepts localhost', () => {
      expect(() => validateDomainPattern('localhost')).not.toThrow();
    });

    it('accepts *.example.com wildcard', () => {
      expect(() => validateDomainPattern('*.example.com')).not.toThrow();
    });

    it('rejects bare wildcard *', () => {
      expect(() => validateDomainPattern('*')).toThrow('too broad');
    });

    it('rejects *.com (TLD-only wildcard)', () => {
      expect(() => validateDomainPattern('*.com')).toThrow('too broad');
    });

    it('rejects *.org (TLD-only wildcard)', () => {
      expect(() => validateDomainPattern('*.org')).toThrow('too broad');
    });

    it('rejects pattern with protocol', () => {
      expect(() => validateDomainPattern('https://example.com')).toThrow('protocol');
    });

    it('rejects pattern with port', () => {
      expect(() => validateDomainPattern('example.com:8080')).toThrow('port');
    });

    it('rejects pattern with path', () => {
      expect(() => validateDomainPattern('example.com/api')).toThrow('path');
    });

    it('rejects empty string', () => {
      expect(() => validateDomainPattern('')).toThrow('empty');
    });

    it('rejects non-string', () => {
      expect(() => validateDomainPattern(null)).toThrow('empty');
    });
  });

  describe('matchesDomainPattern', () => {
    it('exact match', () => {
      expect(matchesDomainPattern('example.com', 'example.com')).toBe(true);
    });

    it('exact match is case-insensitive', () => {
      expect(matchesDomainPattern('Example.COM', 'example.com')).toBe(true);
    });

    it('no match for different domain', () => {
      expect(matchesDomainPattern('other.com', 'example.com')).toBe(false);
    });

    it('wildcard matches subdomain', () => {
      expect(matchesDomainPattern('api.example.com', '*.example.com')).toBe(true);
    });

    it('wildcard does not match base domain', () => {
      expect(matchesDomainPattern('example.com', '*.example.com')).toBe(false);
    });

    it('wildcard is case-insensitive', () => {
      expect(matchesDomainPattern('API.Example.COM', '*.example.com')).toBe(true);
    });

    it('wildcard matches deep subdomain', () => {
      expect(matchesDomainPattern('deep.sub.example.com', '*.example.com')).toBe(true);
    });
  });

  describe('isUrlAllowed', () => {
    it('allows all when policy is null', () => {
      expect(isUrlAllowed('http://anything.com/', null)).toBe(true);
    });

    it('returns false for invalid URL', () => {
      expect(isUrlAllowed('not-a-url', { allowedDomains: ['example.com'] })).toBe(false);
    });

    it('allows matching allowedDomains', () => {
      expect(isUrlAllowed('http://api.example.com/test', { allowedDomains: ['api.example.com'] })).toBe(true);
    });

    it('blocks non-matching when allowedDomains set', () => {
      expect(isUrlAllowed('http://evil.com/', { allowedDomains: ['api.example.com'] })).toBe(false);
    });

    it('empty allowedDomains blocks everything', () => {
      expect(isUrlAllowed('http://anything.com/', { allowedDomains: [] })).toBe(false);
    });

    it('deniedDomains blocks matching', () => {
      expect(isUrlAllowed('http://evil.com/', { deniedDomains: ['evil.com'] })).toBe(false);
    });

    it('deniedDomains allows non-matching', () => {
      expect(isUrlAllowed('http://safe.com/', { deniedDomains: ['evil.com'] })).toBe(true);
    });

    it('deniedDomains takes precedence over allowedDomains', () => {
      const policy = { allowedDomains: ['*.example.com'], deniedDomains: ['evil.example.com'] };
      expect(isUrlAllowed('http://evil.example.com/', policy)).toBe(false);
      expect(isUrlAllowed('http://good.example.com/', policy)).toBe(true);
    });

    it('wildcard allowedDomains works', () => {
      expect(isUrlAllowed('http://sub.npmjs.org/pkg', { allowedDomains: ['*.npmjs.org'] })).toBe(true);
    });

    it('allows all when no allowedDomains and no deniedDomains', () => {
      expect(isUrlAllowed('http://anything.com/', {})).toBe(true);
    });
  });

  describe('validateNetworkPolicy', () => {
    it('accepts valid policy with allowedDomains', () => {
      expect(() => validateNetworkPolicy({ allowedDomains: ['api.example.com'] })).not.toThrow();
    });

    it('accepts valid policy with deniedDomains', () => {
      expect(() => validateNetworkPolicy({ deniedDomains: ['evil.com'] })).not.toThrow();
    });

    it('accepts valid policy with both lists', () => {
      expect(() => validateNetworkPolicy({ allowedDomains: ['*.example.com'], deniedDomains: ['evil.example.com'] })).not.toThrow();
    });

    it('accepts empty arrays', () => {
      expect(() => validateNetworkPolicy({ allowedDomains: [], deniedDomains: [] })).not.toThrow();
    });

    it('rejects null', () => {
      expect(() => validateNetworkPolicy(null)).toThrow('non-null object');
    });

    it('rejects non-object', () => {
      expect(() => validateNetworkPolicy('string')).toThrow('non-null object');
    });

    it('rejects non-array allowedDomains', () => {
      expect(() => validateNetworkPolicy({ allowedDomains: 'example.com' })).toThrow('must be arrays');
    });

    it('rejects invalid pattern inside policy', () => {
      expect(() => validateNetworkPolicy({ allowedDomains: ['*'] })).toThrow('too broad');
    });

    it('accepts policy with no domain lists', () => {
      expect(() => validateNetworkPolicy({})).not.toThrow();
    });
  });

  describe('isUrlAllowedAsync', () => {
    it('allows all when policy is null', async () => {
      expect(await isUrlAllowedAsync('http://anything.com/', null)).toBe(true);
    });

    it('returns false for invalid URL', async () => {
      expect(await isUrlAllowedAsync('not-a-url', { allowedDomains: ['example.com'] })).toBe(false);
    });

    it('allows matching allowedDomains without calling askCallback', async () => {
      const ask = vi.fn();
      const policy = { allowedDomains: ['api.example.com'] };
      expect(await isUrlAllowedAsync('http://api.example.com/test', policy, { askCallback: ask })).toBe(true);
      expect(ask).not.toHaveBeenCalled();
    });

    it('blocks denied domains without calling askCallback', async () => {
      const ask = vi.fn();
      const policy = { allowedDomains: ['api.example.com'], deniedDomains: ['evil.com'] };
      expect(await isUrlAllowedAsync('http://evil.com/', policy, { askCallback: ask })).toBe(false);
      expect(ask).not.toHaveBeenCalled();
    });

    it('calls askCallback when URL not in allowedDomains', async () => {
      const ask = vi.fn().mockResolvedValue(true);
      const policy = { allowedDomains: ['safe.com'] };
      expect(await isUrlAllowedAsync('http://unknown.com/', policy, { askCallback: ask })).toBe(true);
      expect(ask).toHaveBeenCalledWith({ url: 'http://unknown.com/', hostname: 'unknown.com', method: undefined });
    });

    it('askCallback can deny the request', async () => {
      const ask = vi.fn().mockResolvedValue(false);
      const policy = { allowedDomains: ['safe.com'] };
      expect(await isUrlAllowedAsync('http://unknown.com/', policy, { askCallback: ask })).toBe(false);
    });

    it('passes method to askCallback', async () => {
      const ask = vi.fn().mockResolvedValue(true);
      const policy = { allowedDomains: ['safe.com'] };
      await isUrlAllowedAsync('http://unknown.com/', policy, { askCallback: ask, method: 'POST' });
      expect(ask).toHaveBeenCalledWith({ url: 'http://unknown.com/', hostname: 'unknown.com', method: 'POST' });
    });

    it('returns false without askCallback when URL not in allowedDomains', async () => {
      const policy = { allowedDomains: ['safe.com'] };
      expect(await isUrlAllowedAsync('http://unknown.com/', policy)).toBe(false);
    });

    it('allows all when no allowedDomains and no deniedDomains', async () => {
      expect(await isUrlAllowedAsync('http://anything.com/', {})).toBe(true);
    });
  });
});
