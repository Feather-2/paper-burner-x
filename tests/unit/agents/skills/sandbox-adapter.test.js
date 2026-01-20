import { beforeEach, describe, expect, it, vi } from 'vitest';

const skillExecutorState = vi.hoisted(() => ({
  executeMock: vi.fn(),
  executeManyMock: vi.fn(),
  disposeMock: vi.fn(),
  constructorMock: vi.fn(),
  instances: [],
}));

vi.mock('../../../../js/agents/core/sandbox/skill-executor.js', () => ({
  SkillExecutor: vi.fn().mockImplementation(function(options) {
    skillExecutorState.constructorMock(options);
    const instance = {
      execute: (...args) => skillExecutorState.executeMock(...args),
      executeMany: (...args) => skillExecutorState.executeManyMock(...args),
      dispose: (...args) => skillExecutorState.disposeMock(...args),
      options,
    };
    skillExecutorState.instances.push(instance);
    return instance;
  }),
}));

const skillsManagerState = vi.hoisted(() => ({
  constructorMock: vi.fn(),
  shouldThrow: false,
}));

vi.mock('../../../../js/agents/skills/manager.js', () => {
  class SkillsManager {
    constructor(options) {
      if (skillsManagerState.shouldThrow) {
        throw new Error('manager boom');
      }
      skillsManagerState.constructorMock(options);
      this.options = options;
      this.remoteProvider = options?.remoteProvider;
      this.getSkillsForCwd = vi.fn(async () => ({ skills: [] }));
      this.clearCache = vi.fn();
      this.__clearCacheMock = this.clearCache;
    }
  }

  return { SkillsManager };
});

import { analyzeSkillRisk, createSandboxedSkillsManager, enhanceWithSandbox } from '../../../../js/agents/skills/sandbox-adapter.js';

const createManager = (overrides = {}) => {
  const manager = {
    getSkillsForCwd: vi.fn(async () => ({ skills: [] })),
    clearCache: vi.fn(),
    ...overrides,
  };

  if (!manager.__clearCacheMock) {
    manager.__clearCacheMock = manager.clearCache;
  }

  return manager;
};

beforeEach(() => {
  skillExecutorState.executeMock.mockReset();
  skillExecutorState.executeManyMock.mockReset();
  skillExecutorState.disposeMock.mockReset();
  skillExecutorState.constructorMock.mockReset();
  skillExecutorState.instances.length = 0;
  skillsManagerState.constructorMock.mockReset();
  skillsManagerState.shouldThrow = false;
});

describe('enhanceWithSandbox', () => {
  it('adds executor helpers and wires clearCache/dispose', () => {
    const manager = createManager();
    const kernel = { id: 'kernel' };
    const trustChecker = vi.fn();

    const enhanced = enhanceWithSandbox(manager, { kernel, trustChecker });

    expect(enhanced).toBe(manager);
    expect(typeof manager.executeSkill).toBe('function');
    expect(typeof manager.executeSkills).toBe('function');
    expect(typeof manager.getExecutor).toBe('function');
    expect(typeof manager.dispose).toBe('function');

    expect(skillExecutorState.constructorMock).toHaveBeenCalledWith({ kernel, trustChecker });
    expect(manager.getExecutor()).toBe(skillExecutorState.instances[0]);

    manager.clearCache('/tmp/cache');
    expect(manager.__clearCacheMock).toHaveBeenCalledWith('/tmp/cache');

    manager.dispose();
    expect(skillExecutorState.disposeMock).toHaveBeenCalledTimes(1);
  });

  it('executes named skill and passes nested context', async () => {
    const skill = { metadata: { name: 'alpha', scope: 'local' }, body: 'code' };
    const deepContext = {
      cwd: '/root',
      meta: { a: { b: { c: { d: { e: 'value' } } } } },
      list: [{ x: [1, 2, 3] }],
    };
    const manager = createManager({
      getSkillsForCwd: vi.fn(async (cwd) => {
        expect(cwd).toBe('/root');
        return { skills: [skill] };
      }),
    });

    const enhanced = enhanceWithSandbox(manager);
    skillExecutorState.executeMock.mockResolvedValue({ success: true, value: 42 });

    const result = await enhanced.executeSkill('alpha', deepContext);

    expect(skillExecutorState.executeMock).toHaveBeenCalledWith(skill, deepContext);
    expect(result).toEqual({ success: true, value: 42 });
  });

  it('returns error for missing or whitespace skill names', async () => {
    const manager = createManager({
      getSkillsForCwd: vi.fn(async () => ({ skills: [] })),
    });

    const enhanced = enhanceWithSandbox(manager);
    const result = await enhanced.executeSkill('   ', { cwd: '/none' });

    expect(result).toEqual({
      success: false,
      error: 'Skill not found:    ',
      data: null,
      metrics: {},
    });
    expect(skillExecutorState.executeMock).not.toHaveBeenCalled();
  });

  it('loads remote skill body before executing', async () => {
    const skill = { metadata: { name: 'remote', scope: 'remote' }, body: null };
    const remoteProvider = {
      loadSkillBody: vi.fn(async () => 'remote body'),
    };
    const manager = createManager({
      remoteProvider,
      getSkillsForCwd: vi.fn(async () => ({ skills: [skill] })),
    });

    const enhanced = enhanceWithSandbox(manager);
    skillExecutorState.executeMock.mockResolvedValue({ success: true });

    const result = await enhanced.executeSkill('remote', { cwd: '/remote' });

    expect(remoteProvider.loadSkillBody).toHaveBeenCalledWith('remote');
    expect(skill.body).toBe('remote body');
    expect(skillExecutorState.executeMock).toHaveBeenCalledWith(skill, { cwd: '/remote' });
    expect(result).toEqual({ success: true });
  });

  it('returns error when remote skill body fails to load', async () => {
    const skill = { metadata: { name: 'remote', scope: 'remote' }, body: null };
    const remoteProvider = {
      loadSkillBody: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const manager = createManager({
      remoteProvider,
      getSkillsForCwd: vi.fn(async () => ({ skills: [skill] })),
    });

    const enhanced = enhanceWithSandbox(manager);
    const result = await enhanced.executeSkill('remote', { cwd: '/remote' });

    expect(result).toEqual({
      success: false,
      error: 'Failed to load remote skill: boom',
      data: null,
      metrics: {},
    });
    expect(skillExecutorState.executeMock).not.toHaveBeenCalled();
  });

  it('executes provided skill objects with large bodies and empty context', async () => {
    const largeBody = 'x'.repeat(200000);
    const skill = { metadata: { name: 'big', scope: 'local' }, body: largeBody };
    const manager = createManager();

    const enhanced = enhanceWithSandbox(manager);
    skillExecutorState.executeMock.mockResolvedValue({ success: true, size: largeBody.length });

    const result = await enhanced.executeSkill(skill, {});

    expect(skillExecutorState.executeMock).toHaveBeenCalledWith(skill, {});
    expect(result).toEqual({ success: true, size: largeBody.length });
  });

  it('executes batches and ignores missing skills', async () => {
    const skillA = { metadata: { name: 'alpha' }, body: 'a' };
    const skillB = { metadata: { name: 'beta' }, body: 'b' };
    const manager = createManager({
      getSkillsForCwd: vi.fn(async (cwd) => {
        expect(cwd).toBe('/batch');
        return { skills: [skillA, skillB] };
      }),
    });

    const enhanced = enhanceWithSandbox(manager);
    skillExecutorState.executeManyMock.mockResolvedValue([{ success: true }]);

    const result = await enhanced.executeSkills(['alpha', 'missing', 'beta'], { cwd: '/batch' });

    expect(skillExecutorState.executeManyMock).toHaveBeenCalledWith([skillA, skillB], { cwd: '/batch' });
    expect(result).toEqual([{ success: true }]);
  });

  it('handles empty skill list in batch execution', async () => {
    const manager = createManager({
      getSkillsForCwd: vi.fn(async () => ({ skills: [] })),
    });

    const enhanced = enhanceWithSandbox(manager);
    skillExecutorState.executeManyMock.mockResolvedValue([]);

    const result = await enhanced.executeSkills([], { cwd: '/empty' });

    expect(skillExecutorState.executeManyMock).toHaveBeenCalledWith([], { cwd: '/empty' });
    expect(result).toEqual([]);
  });

  it('rejects when skillNames is not an array', async () => {
    const manager = createManager();
    const enhanced = enhanceWithSandbox(manager);

    await expect(enhanced.executeSkills({})).rejects.toThrow(TypeError);
  });

  it('supports concurrent and rapid consecutive executeSkill calls', async () => {
    const skillA = { metadata: { name: 'alpha' }, body: 'a' };
    const skillB = { metadata: { name: 'beta' }, body: 'b' };
    const manager = createManager({
      getSkillsForCwd: vi.fn(async () => ({ skills: [skillA, skillB] })),
    });

    const enhanced = enhanceWithSandbox(manager);
    skillExecutorState.executeMock.mockImplementation(async (skill, context) => ({
      success: true,
      name: skill.metadata.name,
      cwd: context.cwd ?? null,
    }));

    const [resultA, resultB] = await Promise.all([
      enhanced.executeSkill('alpha', { cwd: '/a' }),
      enhanced.executeSkill('beta', { cwd: '/b' }),
    ]);

    expect(resultA).toEqual({ success: true, name: 'alpha', cwd: '/a' });
    expect(resultB).toEqual({ success: true, name: 'beta', cwd: '/b' });

    await enhanced.executeSkill('alpha', { cwd: '/fast' });
    await enhanced.executeSkill('beta', { cwd: '/fast2' });

    expect(skillExecutorState.executeMock).toHaveBeenCalledTimes(4);
  });
});

describe('createSandboxedSkillsManager', () => {
  it('constructs manager with options and enhances it', async () => {
    const remoteProvider = { id: 'remote' };
    const kernel = { id: 'kernel' };
    const trustChecker = vi.fn();

    const manager = await createSandboxedSkillsManager({
      homeDir: '/home/user',
      manifestUrl: 'https://example.com/manifest',
      remoteProvider,
      cacheTtlMs: 0,
      cacheMaxEntries: Number.MAX_SAFE_INTEGER,
      kernel,
      trustChecker,
    });

    expect(skillsManagerState.constructorMock).toHaveBeenCalledWith({
      homeDir: '/home/user',
      manifestUrl: 'https://example.com/manifest',
      remoteProvider,
      cacheTtlMs: 0,
      cacheMaxEntries: Number.MAX_SAFE_INTEGER,
    });
    expect(typeof manager.executeSkill).toBe('function');
    expect(typeof manager.executeSkills).toBe('function');
    expect(skillExecutorState.constructorMock).toHaveBeenCalledWith({ kernel, trustChecker });
  });

  it('passes string numeric options through to the manager', async () => {
    await createSandboxedSkillsManager({
      cacheTtlMs: '123',
      cacheMaxEntries: '-1',
    });

    expect(skillsManagerState.constructorMock).toHaveBeenCalledWith({
      homeDir: undefined,
      manifestUrl: undefined,
      remoteProvider: undefined,
      cacheTtlMs: '123',
      cacheMaxEntries: '-1',
    });
  });

  it('rejects when options is null', async () => {
    await expect(createSandboxedSkillsManager(null)).rejects.toThrow(TypeError);
  });

  it('propagates constructor failures from SkillsManager', async () => {
    skillsManagerState.shouldThrow = true;

    await expect(createSandboxedSkillsManager({})).rejects.toThrow('manager boom');
  });
});

describe('analyzeSkillRisk', () => {
  it('returns safe for empty or nullish input', () => {
    const inputs = ['', '   ', null, undefined];
    for (const input of inputs) {
      const result = analyzeSkillRisk(input);
      expect(result).toEqual({ overallRisk: 'safe', risks: [], safe: true });
    }
  });

  it('detects risks and reports the highest severity', () => {
    const body = 'const a = eval(\"1\"); const b = fetch(\"/api\"); const c = child_process.exec(\"ls\");';
    const result = analyzeSkillRisk(body);

    expect(result.overallRisk).toBe('critical');
    expect(result.safe).toBe(false);

    const evalRisk = result.risks.find((risk) => risk.desc === 'Uses eval()');
    const childProcessRisk = result.risks.find((risk) => risk.desc === 'Uses child_process');

    expect(evalRisk).toMatchObject({ risk: 'high', pattern: 'eval\\s*\\(' });
    expect(childProcessRisk).toMatchObject({ risk: 'critical', pattern: 'child_process' });
  });

  it('handles long strings and flags low-risk patterns', () => {
    const longBody = 'a'.repeat(200000) + ' XMLHttpRequest ';
    const result = analyzeSkillRisk(longBody);

    expect(result.overallRisk).toBe('low');
    expect(result.safe).toBe(false);
    expect(result.risks).toHaveLength(1);
    expect(result.risks[0]).toMatchObject({ risk: 'low', pattern: 'XMLHttpRequest' });
  });

  it('treats numeric boundary values as safe', () => {
    const results = [
      analyzeSkillRisk(0),
      analyzeSkillRisk(-1),
      analyzeSkillRisk(Number.MAX_SAFE_INTEGER),
    ];

    for (const result of results) {
      expect(result).toEqual({ overallRisk: 'safe', risks: [], safe: true });
    }
  });
});
