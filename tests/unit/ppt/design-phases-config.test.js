import { describe, it, test, expect, beforeEach, afterEach, vi } from 'vitest';

test('Design phases config: labels, ordering, terminal states', async () => {
  const {
    DESIGN_PHASES_CONFIG,
    getDesignPhaseOrder,
    getDesignPhaseLabel,
    isDesignPhaseTerminal,
  } = await import('../../../js/ppt/design/design-phases-config.js');

  expect(DESIGN_PHASES_CONFIG.generating.label).toBe('生成页面');
  expect(getDesignPhaseLabel('style_extracting', 'en')).toBe('Extracting Style');
  expect(getDesignPhaseLabel('unknown_phase')).toBe('unknown_phase');

  const order = getDesignPhaseOrder().map((item) => item.key);
  expect(order.includes('generating')).toBeTruthy();
  expect(!order.includes('idle')).toBeTruthy();
  expect(!order.includes('failed')).toBeTruthy();
  expect(!order.includes('editing')).toBeTruthy();

  expect(isDesignPhaseTerminal('completed')).toBe(true);
  expect(isDesignPhaseTerminal('failed')).toBe(true);
  expect(isDesignPhaseTerminal('editing')).toBe(true);
  expect(isDesignPhaseTerminal('outline_parsing')).toBe(false);
});

test('Design phases config: calculateDesignProgress', async () => {
  const { calculateDesignProgress } = await import('../../../js/ppt/design/design-phases-config.js');

  expect(calculateDesignProgress('unknown')).toBe(0);
  expect(calculateDesignProgress('failed')).toBe(0);
  expect(calculateDesignProgress('completed')).toBe(100);

  expect(calculateDesignProgress('style_confirming')).toBe(20);
  expect(calculateDesignProgress('generating')).toBe(25);
  expect(calculateDesignProgress('generating', 2, 4)).toBe(45);
});
