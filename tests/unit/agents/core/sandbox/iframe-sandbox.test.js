import { describe, it, expect } from 'vitest';
import { buildGuestScript, createIframeSandbox } from '../../../../../js/agents/core/sandbox/iframe-sandbox.js';

describe('iframe-sandbox', () => {
  describe('buildGuestScript', () => {
    it('returns a non-empty string', () => {
      const script = buildGuestScript();
      expect(typeof script).toBe('string');
      expect(script.length).toBeGreaterThan(0);
    });

    it('contains message event listener', () => {
      const script = buildGuestScript();
      expect(script).toContain('addEventListener');
      expect(script).toContain('message');
    });

    it('contains execute message type', () => {
      const script = buildGuestScript();
      expect(script).toContain('iframe-sandbox:execute');
    });

    it('contains result message type', () => {
      const script = buildGuestScript();
      expect(script).toContain('iframe-sandbox:result');
    });

    it('contains console proxy', () => {
      const script = buildGuestScript();
      expect(script).toContain('iframe-sandbox:console');
      expect(script).toContain('console');
    });

    it('uses eval for code execution', () => {
      const script = buildGuestScript();
      expect(script).toContain('eval');
    });
  });

  describe('createIframeSandbox', () => {
    it('throws in Node.js environment (no DOM)', () => {
      expect(() => createIframeSandbox()).toThrow('DOM environment');
    });

    it('throws with custom config in Node.js', () => {
      expect(() => createIframeSandbox({ timeout: 5000 })).toThrow('DOM environment');
    });
  });
});
