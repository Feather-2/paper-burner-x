import { describe, it, expect, vi } from 'vitest';

const mocked = vi.hoisted(() => ({
  runStore: {
    RunStore: class RunStore {},
    RunStoreConstants: { VERSION: 1 },
  },
  crud: {
    saveTask: vi.fn(),
  },
  queries: {
    listRuns: vi.fn(),
  },
  cache: {
    cleanupRuns: vi.fn(),
  },
  exporter: {
    exportRunAsZip: vi.fn(),
  },
  artifacts: {
    canonicalArtifactType: vi.fn(),
  },
  utils: {
    DB_NAME: 'AgentRuntimeDB',
  },
}));

vi.mock('../../../../js/agents/storage/run-store.js', () => mocked.runStore);
vi.mock('../../../../js/agents/storage/run-store-utils.js', () => mocked.utils);
vi.mock('../../../../js/agents/storage/run-store-crud.js', () => mocked.crud);
vi.mock('../../../../js/agents/storage/run-store-queries.js', () => mocked.queries);
vi.mock('../../../../js/agents/storage/run-store-cache.js', () => mocked.cache);
vi.mock('../../../../js/agents/storage/run-exporter.js', () => mocked.exporter);
vi.mock('../../../../js/agents/storage/artifact-manager.js', () => mocked.artifacts);

describe('storage/index', () => {
  it('re-exports run store and storage helpers from aggregate entry', async () => {
    const mod = await import('../../../../js/agents/storage/index.js');

    expect(mod.RunStore).toBe(mocked.runStore.RunStore);
    expect(mod.RunStoreConstants).toBe(mocked.runStore.RunStoreConstants);
    expect(mod.saveTask).toBe(mocked.crud.saveTask);
    expect(mod.listRuns).toBe(mocked.queries.listRuns);
    expect(mod.cleanupRuns).toBe(mocked.cache.cleanupRuns);
    expect(mod.exportRunAsZip).toBe(mocked.exporter.exportRunAsZip);
    expect(mod.canonicalArtifactType).toBe(mocked.artifacts.canonicalArtifactType);
    expect(mod.DB_NAME).toBe('AgentRuntimeDB');
  });
});
