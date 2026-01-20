/**
 * @file tests/chatbot/token-budget.test.js
 * @description TokenBudgetManager 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';

const previousWindow = globalThis.window;
const previousWindowManager = previousWindow?.TokenBudgetManager;
const previousGlobalManager = globalThis.TokenBudgetManager;

const loadManager = async () => {
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = globalThis;
  }

  const module = await import('../../../js/chatbot/react/token-budget.js');
  return module.TokenBudgetManager;
};

describe('TokenBudgetManager', () => {
  let TokenBudgetManager;

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    TokenBudgetManager = await loadManager();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    if (typeof previousWindow === 'undefined') {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }

    if (typeof previousGlobalManager === 'undefined') {
      delete globalThis.TokenBudgetManager;
    } else {
      globalThis.TokenBudgetManager = previousGlobalManager;
    }

    if (previousWindow) {
      if (typeof previousWindowManager === 'undefined') {
        delete previousWindow.TokenBudgetManager;
      } else {
        previousWindow.TokenBudgetManager = previousWindowManager;
      }
    }
  });

  describe('estimate', () => {
    it('should estimate Chinese characters', () => {
      const manager = new TokenBudgetManager();
      expect(manager.estimate('你好')).toBe(3);
    });

    it('should estimate English characters', () => {
      const manager = new TokenBudgetManager();
      expect(manager.estimate('hello')).toBe(2);
    });

    it('should estimate mixed content', () => {
      const manager = new TokenBudgetManager();
      expect(manager.estimate('你好hello')).toBe(5);
    });

    it('should return 0 for empty/null/undefined input', () => {
      const manager = new TokenBudgetManager();
      expect(manager.estimate('')).toBe(0);
      expect(manager.estimate(null)).toBe(0);
      expect(manager.estimate(undefined)).toBe(0);
    });
  });

  describe('isOverBudget', () => {
    it('should return false when within budget', () => {
      const manager = new TokenBudgetManager({ totalBudget: 5 });
      const contexts = { system: 'hello', history: 'hello' }; // 2 + 2 = 4 <= 5
      expect(manager.isOverBudget(contexts)).toBe(false);
    });

    it('should return true when over budget', () => {
      const manager = new TokenBudgetManager({ totalBudget: 5 });
      const contexts = { system: 'hello', history: 'hello', context: 'hello' }; // 2 + 2 + 2 = 6 > 5
      expect(manager.isOverBudget(contexts)).toBe(true);
    });
  });

  describe('getRemainingContextBudget', () => {
    it('should return remaining context budget after system prompt + history', () => {
      const manager = new TokenBudgetManager({ contextTokens: 10 });
      expect(manager.getRemainingContextBudget('hello', '你好')).toBe(5);
    });

    it('should clamp remaining context budget to 0', () => {
      const manager = new TokenBudgetManager({ contextTokens: 4 });
      expect(manager.getRemainingContextBudget('hello', '你好')).toBe(0);
    });
  });
});

