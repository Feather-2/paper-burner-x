import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockState = vi.hoisted(() => {
  /** @type {any[]} */
  const executorInstances = [];
  /** @type {any[]} */
  const executorCtorArgs = [];

  /** @type {any[]} */
  const skillsManagerInstances = [];
  /** @type {any[]} */
  const skillsManagerCtorArgs = [];

  function defaultSkillExecutorCtor(opts) {
    executorCtorArgs.push(opts);
    this.execute = vi.fn(async (skill, context) => ({ success: true, skill, context }));
    this.executeMany = vi.fn(async (skills, context) => ({ success: true, skills, context }));
    this.dispose = vi.fn();
    executorInstances.push(this);
  }

  function defaultSkillsManagerCtor(opts) {
    skillsManagerCtorArgs.push(opts);
    this.remoteProvider = opts?.remoteProvider;
    this.getSkillsForCwd = vi.fn(async () => ({ skills: [] }));
    skillsManagerInstances.push(this);
  }

  const SkillExecutor = vi.fn(defaultSkillExecutorCtor);
  const SkillsManager = vi.fn(defaultSkillsManagerCtor);

  return {
    executorInstances,
    executorCtorArgs,
    skillsManagerInstances,
    skillsManagerCtorArgs,
    defaultSkillExecutorCtor,
    defaultSkillsManagerCtor,
    SkillExecutor,
    SkillsManager,
  };
});

vi.mock('../../../../js/agents/core/sandbox/skill-executor.js', () => ({
  SkillExecutor: mockState.SkillExecutor,
}));

vi.mock('../../../../js/agents/skills/manager.js', () => ({
  SkillsManager: mockState.SkillsManager,
}));

import {
  enhanceWithSandbox,
  createSandboxedSkillsManager,
  analyzeSkillRisk,
} from '../../../../js/agents/skills/sandbox-adapter.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockState.executorInstances.length = 0;
  mockState.executorCtorArgs.length = 0;
  mockState.skillsManagerInstances.length = 0;
  mockState.skillsManagerCtorArgs.length = 0;

  mockState.SkillExecutor.mockImplementation(mockState.defaultSkillExecutorCtor);
  mockState.SkillsManager.mockImplementation(mockState.defaultSkillsManagerCtor);
});

describe('enhanceWithSandbox', () => {
  it('returns the same manager and wires executor options', () => {
    const trustChecker = vi.fn(() => true);
    const manager = {
      getSkillsForCwd: vi.fn(async () => ({ skills: [] })),
    };

    const returned = enhanceWithSandbox(manager, { kernel: 'kernel', trustChecker });

    expect(returned).toBe(manager);
    expect(mockState.SkillExecutor).toHaveBeenCalledTimes(1);
    expect(mockState.executorCtorArgs[0]).toEqual({ kernel: 'kernel', trustChecker });

    expect(typeof manager.executeSkill).toBe('function');
    expect(typeof manager.executeSkills).toBe('function');
    expect(typeof manager.getExecutor).toBe('function');
    expect(typeof manager.dispose).toBe('function');

    const executor = manager.getExecutor();
    expect(executor).toBe(mockState.executorInstances[0]);

    manager.dispose();
    expect(executor.dispose).toHaveBeenCalledTimes(1);
  });

  it('executeSkill forwards skill objects to executor.execute', async () => {
    const manager = {
      getSkillsForCwd: vi.fn(async () => ({ skills: [] })),
    };
    enhanceWithSandbox(manager);

    const executor = manager.getExecutor();
    executor.execute.mockResolvedValueOnce({ success: true, data: 'ok' });

    const skill = { metadata: { name: 's1', scope: 'local' }, body: 'return 1;' };
    const context = { cwd: '/tmp' };
    const result = await manager.executeSkill(skill, context);

    expect(manager.getSkillsForCwd).not.toHaveBeenCalled();
    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(executor.execute).toHaveBeenCalledWith(skill, context);
    expect(result).toEqual({ success: true, data: 'ok' });
  });

  it('executeSkill looks up by name and returns a structured error when missing (including empty string)', async () => {
    const manager = {
      getSkillsForCwd: vi.fn(async () => ({ skills: [] })),
    };
    enhanceWithSandbox(manager);

    const executor = manager.getExecutor();

    const res1 = await manager.executeSkill('missing', { cwd: '/repo' });
    expect(manager.getSkillsForCwd).toHaveBeenCalledWith('/repo');
    expect(executor.execute).not.toHaveBeenCalled();
    expect(res1).toEqual({
      success: false,
      error: 'Skill not found: missing',
      data: null,
      metrics: {},
    });

    manager.getSkillsForCwd.mockResolvedValueOnce({ skills: [] });
    const res2 = await manager.executeSkill('', {});
    expect(manager.getSkillsForCwd).toHaveBeenLastCalledWith(undefined);
    expect(res2).toEqual({
      success: false,
      error: 'Skill not found: ',
      data: null,
      metrics: {},
    });
  });

  it('loads remote skill body when body is null and scope is remote', async () => {
    const remoteSkill = { metadata: { name: 'remote', scope: 'remote' }, body: null };

    const manager = {
      remoteProvider: { loadSkillBody: vi.fn(async () => 'REMOTE_BODY') },
      getSkillsForCwd: vi.fn(async () => ({ skills: [remoteSkill] })),
    };
    enhanceWithSandbox(manager);

    const executor = manager.getExecutor();
    executor.execute.mockResolvedValueOnce({ success: true, data: 'ran' });

    const out = await manager.executeSkill('remote', { cwd: '/x' });

    expect(manager.remoteProvider.loadSkillBody).toHaveBeenCalledTimes(1);
    expect(manager.remoteProvider.loadSkillBody).toHaveBeenCalledWith('remote');
    expect(remoteSkill.body).toBe('REMOTE_BODY');

    expect(executor.execute).toHaveBeenCalledTimes(1);
    expect(executor.execute).toHaveBeenCalledWith(remoteSkill, { cwd: '/x' });
    expect(out).toEqual({ success: true, data: 'ran' });
  });

  it('returns a structured error when remote skill body loading throws (including non-Error)', async () => {
    const remoteSkill = { metadata: { name: 'remote', scope: 'remote' }, body: null };

    const manager = {
      remoteProvider: { loadSkillBody: vi.fn(async () => { throw 'bad'; }) },
      getSkillsForCwd: vi.fn(async () => ({ skills: [remoteSkill] })),
    };
    enhanceWithSandbox(manager);

    const executor = manager.getExecutor();

    const out = await manager.executeSkill('remote', { cwd: '/x' });

    expect(manager.remoteProvider.loadSkillBody).toHaveBeenCalledTimes(1);
    expect(executor.execute).not.toHaveBeenCalled();
    expect(out).toEqual({
      success: false,
      error: 'Failed to load remote skill: bad',
      data: null,
      metrics: {},
    });
  });

  it('executes remote skills with null body when no remote loader exists', async () => {
    const remoteSkill = { metadata: { name: 'remote', scope: 'remote' }, body: null };

    const manager = {
      remoteProvider: {},
      getSkillsForCwd: vi.fn(async () => ({ skills: [remoteSkill] })),
    };
    enhanceWithSandbox(manager);

    const executor = manager.getExecutor();
    executor.execute.mockResolvedValueOnce({ success: true, data: 'ok' });

    const out = await manager.executeSkill('remote', { cwd: '/x' });

    expect(remoteSkill.body).toBe(null);
    expect(executor.execute).toHaveBeenCalledWith(remoteSkill, { cwd: '/x' });
    expect(out).toEqual({ success: true, data: 'ok' });
  });

  it('executeSkills filters missing skills, preserves order, and handles empty arrays', async () => {
    const skillA = { metadata: { name: 'a', scope: 'local' }, body: 'A' };
    const skillB = { metadata: { name: 'b', scope: 'local' }, body: 'B' };

    const manager = {
      getSkillsForCwd: vi.fn(async () => ({ skills: [skillA, skillB] })),
    };
    enhanceWithSandbox(manager);

    const executor = manager.getExecutor();
    executor.executeMany.mockResolvedValueOnce({ success: true, data: 'batch' });

    const out = await manager.executeSkills(['a', 'missing', 'b'], { cwd: '/repo' });

    expect(executor.executeMany).toHaveBeenCalledTimes(1);
    expect(executor.executeMany).toHaveBeenCalledWith([skillA, skillB], { cwd: '/repo' });
    expect(out).toEqual({ success: true, data: 'batch' });

    executor.executeMany.mockResolvedValueOnce({ success: true, data: 'empty' });
    const outEmpty = await manager.executeSkills([], { cwd: '/repo' });
    expect(executor.executeMany).toHaveBeenLastCalledWith([], { cwd: '/repo' });
    expect(outEmpty).toEqual({ success: true, data: 'empty' });
  });

  it('executeSkills rejects when skillNames is not an array', async () => {
    const manager = {
      getSkillsForCwd: vi.fn(async () => ({ skills: [] })),
    };
    enhanceWithSandbox(manager);

    await expect(manager.executeSkills('not-an-array', { cwd: '/repo' })).rejects.toBeInstanceOf(
      TypeError,
    );
  });

  it('supports concurrent executeSkill calls without cross-talk', async () => {
    const manager = {
      getSkillsForCwd: vi.fn(async () => ({ skills: [] })),
    };
    enhanceWithSandbox(manager);

    const executor = manager.getExecutor();
    executor.execute.mockImplementation(async (skill, context) => ({
      ok: true,
      name: skill?.metadata?.name,
      cwd: context?.cwd,
    }));

    const s1 = { metadata: { name: 's1', scope: 'local' }, body: '1' };
    const s2 = { metadata: { name: 's2', scope: 'local' }, body: '2' };

    const [r1, r2] = await Promise.all([
      manager.executeSkill(s1, { cwd: '/a' }),
      manager.executeSkill(s2, { cwd: '/b' }),
    ]);

    expect(executor.execute).toHaveBeenCalledTimes(2);
    expect(r1).toEqual({ ok: true, name: 's1', cwd: '/a' });
    expect(r2).toEqual({ ok: true, name: 's2', cwd: '/b' });
  });

  it('throws when manager or options are null', () => {
    expect(() => enhanceWithSandbox(null)).toThrow();
    expect(() => enhanceWithSandbox({ getSkillsForCwd: vi.fn() }, null)).toThrow();
  });
});

describe('createSandboxedSkillsManager', () => {
  it('constructs SkillsManager with provided options and returns an enhanced manager', async () => {
    const remoteProvider = { loadSkillBody: vi.fn(async () => 'x') };
    const trustChecker = vi.fn(() => true);
    const kernel = { kind: 'kernel' };

    const manager = await createSandboxedSkillsManager({
      homeDir: '/home/user',
      manifestUrl: 'https://example.invalid/skills.json',
      remoteProvider,
      cacheTtlMs: 0,
      cacheMaxEntries: Number.MAX_SAFE_INTEGER,
      kernel,
      trustChecker,
    });

    expect(mockState.SkillsManager).toHaveBeenCalledTimes(1);
    expect(mockState.skillsManagerCtorArgs[0]).toEqual({
      homeDir: '/home/user',
      manifestUrl: 'https://example.invalid/skills.json',
      remoteProvider,
      cacheTtlMs: 0,
      cacheMaxEntries: Number.MAX_SAFE_INTEGER,
    });

    expect(mockState.SkillExecutor).toHaveBeenCalledTimes(1);
    expect(mockState.executorCtorArgs[0]).toEqual({ kernel, trustChecker });

    expect(manager).toBe(mockState.skillsManagerInstances[0]);
    expect(typeof manager.executeSkill).toBe('function');
    expect(typeof manager.executeSkills).toBe('function');
    expect(typeof manager.getExecutor).toBe('function');
    expect(typeof manager.dispose).toBe('function');
    expect(manager.remoteProvider).toBe(remoteProvider);
  });

  it('supports default/empty options', async () => {
    const manager = await createSandboxedSkillsManager();

    expect(mockState.SkillsManager).toHaveBeenCalledTimes(1);
    expect(mockState.skillsManagerCtorArgs[0]).toEqual({
      homeDir: undefined,
      manifestUrl: undefined,
      remoteProvider: undefined,
      cacheTtlMs: undefined,
      cacheMaxEntries: undefined,
    });

    expect(typeof manager.executeSkill).toBe('function');
  });

  it('bubbles up SkillsManager constructor errors', async () => {
    mockState.SkillsManager.mockImplementationOnce(function SkillsManager() {
      throw new Error('boom');
    });

    await expect(createSandboxedSkillsManager({})).rejects.toThrow('boom');
  });

  it('supports concurrent creation with different options', async () => {
    const [m1, m2] = await Promise.all([
      createSandboxedSkillsManager({ homeDir: '/h1', cacheTtlMs: '0', cacheMaxEntries: -1 }),
      createSandboxedSkillsManager({ homeDir: '/h2', cacheTtlMs: 1, cacheMaxEntries: 0 }),
    ]);

    expect(mockState.SkillsManager).toHaveBeenCalledTimes(2);
    expect(mockState.SkillExecutor).toHaveBeenCalledTimes(2);

    expect(m1).not.toBe(m2);
    expect(m1).toBe(mockState.skillsManagerInstances[0]);
    expect(m2).toBe(mockState.skillsManagerInstances[1]);
  });
});

describe('analyzeSkillRisk', () => {
  it('treats empty-ish inputs as safe (null/undefined/empty/whitespace/0/-1/MAX_SAFE_INTEGER/empty array/object)', () => {
    const inputs = [
      '',
      ' \n\t ',
      null,
      undefined,
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      '0',
      String(Number.MAX_SAFE_INTEGER),
    ];

    for (const input of inputs) {
      const result = analyzeSkillRisk(/** @type {any} */ (input));
      expect(result.overallRisk).toBe('safe');
      expect(result.risks).toEqual([]);
      expect(result.safe).toBe(true);
    }
  });

  it('reports matching patterns and chooses the highest risk level', () => {
    const result = analyzeSkillRisk('fetch("https://x"); eval("1+1");');

    expect(result.overallRisk).toBe('high');
    expect(Array.isArray(result.risks)).toBe(true);
    expect(result.risks).toEqual(
      expect.arrayContaining([
        { risk: 'high', desc: 'Uses eval()', pattern: 'eval\\s*\\(' },
        { risk: 'low', desc: 'Makes HTTP requests', pattern: 'fetch\\s*\\(' },
      ]),
    );
    expect(typeof result.safe).toBe('boolean');
  });

  it('marks child_process usage as critical and unsafe', () => {
    const result = analyzeSkillRisk('const cp = require("child_process");');

    expect(result.overallRisk).toBe('critical');
    expect(result.safe).toBe(false);
    expect(result.risks).toEqual(
      expect.arrayContaining([
        { risk: 'critical', desc: 'Uses child_process', pattern: 'child_process' },
      ]),
    );
  });

  it('does not duplicate risk entries for repeated occurrences of the same pattern', () => {
    const result = analyzeSkillRisk('eval(1); eval(2); eval(3);');

    const evalFindings = result.risks.filter(r => r.desc === 'Uses eval()');
    expect(evalFindings).toHaveLength(1);
  });

  it('handles very long and deeply nested strings', () => {
    const long = 'a'.repeat(100_000) + ' child_process ';
    const longResult = analyzeSkillRisk(long);
    expect(longResult.overallRisk).toBe('critical');

    let nested = {};
    for (let i = 0; i < 200; i++) nested = { nested };
    const deep = JSON.stringify(nested);

    const deepResult = analyzeSkillRisk(deep);
    expect(deepResult.overallRisk).toBe('safe');
    expect(deepResult.risks).toEqual([]);
    expect(deepResult.safe).toBe(true);
  });

  it('is deterministic under concurrent calls', async () => {
    const [a, b, c] = await Promise.all([
      Promise.resolve(analyzeSkillRisk('eval(')),
      Promise.resolve(analyzeSkillRisk('fetch(')),
      Promise.resolve(analyzeSkillRisk('')),
    ]);

    expect(a.overallRisk).toBe('high');
    expect(b.overallRisk).toBe('low');
    expect(c.overallRisk).toBe('safe');
  });
});