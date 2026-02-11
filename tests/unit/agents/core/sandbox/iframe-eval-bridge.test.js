import { describe, it, expect } from 'vitest';
import {
  isBrowserWithDOM,
  buildEvalGuestScript,
  MSG_EVAL,
  MSG_EVAL_RESULT,
  MSG_CONSOLE,
  createIframeEvalBridge,
} from '../../../../../js/agents/core/sandbox/iframe-eval-bridge.js';

describe('iframe-eval-bridge', () => {
  describe('isBrowserWithDOM', () => {
    it('returns false in Node.js environment', () => {
      expect(isBrowserWithDOM()).toBe(false);
    });
  });

  describe('buildEvalGuestScript', () => {
    it('returns a string containing message handler', () => {
      const script = buildEvalGuestScript();
      expect(typeof script).toBe('string');
      expect(script).toContain('addEventListener');
      expect(script).toContain(MSG_EVAL);
      expect(script).toContain(MSG_EVAL_RESULT);
      expect(script).toContain(MSG_CONSOLE);
    });

    it('intercepts console methods', () => {
      const script = buildEvalGuestScript();
      expect(script).toContain("'log'");
      expect(script).toContain("'warn'");
      expect(script).toContain("'error'");
    });
  });

  describe('message constants', () => {
    it('exports correct message types', () => {
      expect(MSG_EVAL).toBe('iframe-eval:eval');
      expect(MSG_EVAL_RESULT).toBe('iframe-eval:result');
      expect(MSG_CONSOLE).toBe('iframe-eval:console');
    });
  });

  describe('createIframeEvalBridge', () => {
    it('throws in Node.js environment (no DOM)', () => {
      expect(() => createIframeEvalBridge()).toThrow('DOM environment');
    });

    it('throws with custom config in Node.js', () => {
      expect(() => createIframeEvalBridge({ timeout: 5000 })).toThrow('DOM environment');
    });
  });
});
