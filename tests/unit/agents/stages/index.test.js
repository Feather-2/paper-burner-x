import { describe, it, expect, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  deepsearch: {
    DeepSearchAgentLoop: class DeepSearchAgentLoop {},
    runDeepSearchStage: vi.fn(),
  },
  design: {
    DesignAgentLoop: class DesignAgentLoop {},
    runDesignStage: vi.fn(),
  },
  codesearch: {
    CodeSearchStage: class CodeSearchStage {},
  },
  textprep: {
    TextPrepStage: class TextPrepStage {},
  },
}));

vi.mock('../../../../js/agents/stages/deepsearch/index.js', () => mocked.deepsearch);
vi.mock('../../../../js/agents/stages/design/index.js', () => mocked.design);
vi.mock('../../../../js/agents/stages/codesearch/index.js', () => mocked.codesearch);
vi.mock('../../../../js/agents/stages/textprep/index.js', () => mocked.textprep);

describe('stages/index', () => {
  it('re-exports built-in stage modules from aggregate entry', async () => {
    const mod = await import('../../../../js/agents/stages/index.js');

    expect(mod.DeepSearchAgentLoop).toBe(mocked.deepsearch.DeepSearchAgentLoop);
    expect(mod.DesignAgentLoop).toBe(mocked.design.DesignAgentLoop);
    expect(mod.CodeSearchStage).toBe(mocked.codesearch.CodeSearchStage);
    expect(mod.TextPrepStage).toBe(mocked.textprep.TextPrepStage);
  });
});
