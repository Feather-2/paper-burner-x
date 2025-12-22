const test = require('node:test');
const assert = require('node:assert/strict');

test('Design phases config: labels, ordering, terminal states', async () => {
  const {
    DESIGN_PHASES_CONFIG,
    getDesignPhaseOrder,
    getDesignPhaseLabel,
    isDesignPhaseTerminal,
  } = await import('../../js/ppt/design-phases-config.js');

  assert.equal(DESIGN_PHASES_CONFIG.generating.label, '生成页面');
  assert.equal(getDesignPhaseLabel('style_extracting', 'en'), 'Extracting Style');
  assert.equal(getDesignPhaseLabel('unknown_phase'), 'unknown_phase');

  const order = getDesignPhaseOrder().map((item) => item.key);
  assert.ok(order.includes('generating'));
  assert.ok(!order.includes('idle'));
  assert.ok(!order.includes('failed'));
  assert.ok(!order.includes('editing'));

  assert.equal(isDesignPhaseTerminal('completed'), true);
  assert.equal(isDesignPhaseTerminal('failed'), true);
  assert.equal(isDesignPhaseTerminal('editing'), true);
  assert.equal(isDesignPhaseTerminal('outline_parsing'), false);
});

test('Design phases config: calculateDesignProgress', async () => {
  const { calculateDesignProgress } = await import('../../js/ppt/design-phases-config.js');

  assert.equal(calculateDesignProgress('unknown'), 0);
  assert.equal(calculateDesignProgress('failed'), 0);
  assert.equal(calculateDesignProgress('completed'), 100);

  assert.equal(calculateDesignProgress('style_confirming'), 20);
  assert.equal(calculateDesignProgress('generating'), 25);
  assert.equal(calculateDesignProgress('generating', 2, 4), 45);
});
