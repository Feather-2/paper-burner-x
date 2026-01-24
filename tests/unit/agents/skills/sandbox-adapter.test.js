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

import sandboxAdapterDefault, {
  analyzeSkillRisk,
  createSandboxedSkillsManager,
  enhanceWithSandbox,
} from '../../../../js/agents/skills/sandbox-adapter.js';

const createManager = (overrides = {}) => {
  return {
    getSkillsForCwd: vi.fn(async () => ({ skills: [] })),
    ...overrides,
  };
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

describe('default export', () => {
  it('should_export_all_functions_on_default_export', () => {
    // Arrange
    const expected = {
      enhanceWithSandbox,
      createSandboxedSkillsManager,
      analyzeSkillRisk,
    };

    // Act
    const result = sandboxAdapterDefault;

    // Assert
    expect(result).toEqual(expected);
  });
});

describe('enhanceWithSandbox', () => {
  it('should_return_same_manager_when_enhancing', () => {
    // Arrange
    const manager = createManager();

    // Act
    const result = enhanceWithSandbox(manager);

    // Assert
    expect(result).toBe(manager);
  });

  it('should_construct_SkillExecutor_with_kernel_and_trustChecker_when_provided', () => {
    // Arrange
    const manager = createManager();
    const kernel = { id: 'kernel' };
    const trustChecker = vi.fn();

    // Act
    enhanceWithSandbox(manager, { kernel, trustChecker });

    // Assert
    expect(skillExecutorState.constructorMock).toHaveBeenCalledWith({ kernel, trustChecker });
  });

  it('should_add_executeSkill_when_enhancing', () => {
    // Arrange
    const manager = createManager();

    // Act
    enhanceWithSandbox(manager);

    // Assert
    expect(typeof manager.executeSkill).toBe('function');
  });

  it('should_add_executeSkills_when_enhancing', () => {
    // Arrange
    const manager = createManager();

    // Act
    enhanceWithSandbox(manager);

    // Assert
    expect(typeof manager.executeSkills).toBe('function');
  });

  it('should_add_getExecutor_when_enhancing', () => {
    // Arrange
    const manager = createManager();

    // Act
    enhanceWithSandbox(manager);

    // Assert
    expect(typeof manager.getExecutor).toBe('function');
  });

  it('should_add_dispose_when_enhancing', () => {
    // Arrange
    const manager = createManager();

    // Act
    enhanceWithSandbox(manager);

    // Assert
    expect(typeof manager.dispose).toBe('function');
  });

  it('should_return_executor_instance_when_getExecutor_is_called', () => {
    // Arrange
    const manager = createManager();
    const enhanced = enhanceWithSandbox(manager);

    // Act
    const executor = enhanced.getExecutor();

    // Assert
    expect(executor).toBe(skillExecutorState.instances[0]);
  });

  it('should_call_executor_dispose_when_dispose_is_called', () => {
    // Arrange
    const manager = createManager();
    const enhanced = enhanceWithSandbox(manager);

    // Act
    enhanced.dispose();

    // Assert
    expect(skillExecutorState.disposeMock).toHaveBeenCalledTimes(1);
  });

  it('should_return_executor_result_when_skill_object_is_provided', async () => {
    // Arrange
    const largeBody = 'x'.repeat(200000);
    const skill = { metadata: { name: 'big', scope: 'local' }, body: largeBody };
    const context = {
      cwd: '/root',
      meta: { a: { b: { c: { d: { e: 'value' } } } } },
      list: [{ x: [1, 2, 3] }],
    };
    const manager = createManager();
    const enhanced = enhanceWithSandbox(manager);
    const expected = { success: true, size: largeBody.length };

    skillExecutorState.executeMock.mockImplementation(async (skillArg, contextArg) => {
      if (skillArg !== skill) throw new Error('unexpected skill');
      if (contextArg !== context) throw new Error('unexpected context');
      return expected;
    });

    // Act
    const result = await enhanced.executeSkill(skill, context);

    // Assert
    expect(result).toBe(expected);
  });

  it('should_return_executor_result_when_named_skill_is_found', async () => {
    // Arrange
    const skill = { metadata: { name: 'alpha', scope: 'local' }, body: 'code' };
    const context = { cwd: '/root', meta: { a: { b: 1 } } };
    const manager = createManager({
      getSkillsForCwd: vi.fn(async (cwd) => {
        if (cwd !== '/root') throw new Error('unexpected cwd');
        return { skills: [skill] };
      }),
    });
    const enhanced = enhanceWithSandbox(manager);
    const expected = { success: true, value: 42 };

    skillExecutorState.executeMock.mockImplementation(async (skillArg, contextArg) => {
      if (skillArg !== skill) throw new Error('unexpected skill');
      if (contextArg !== context) throw new Error('unexpected context');
      return expected;
    });

    // Act
    const result = await enhanced.executeSkill('alpha', context);

    // Assert
    expect(result).toBe(expected);
  });

  it('should_return_executor_result_when_context_is_omitted_for_named_skill', async () => {
    // Arrange
    const skill = { metadata: { name: 'alpha', scope: 'local' }, body: 'code' };
    const manager = createManager({
      getSkillsForCwd: vi.fn(async (cwd) => {
        if (cwd !== undefined) throw new Error('unexpected cwd');
        return { skills: [skill] };
      }),
    });
    const enhanced = enhanceWithSandbox(manager);
    const expected = { success: true };

    skillExecutorState.executeMock.mockImplementation(async (skillArg, contextArg) => {
      if (skillArg !== skill) throw new Error('unexpected skill');
      if (!contextArg || Object.keys(contextArg).length !== 0) throw new Error('unexpected context');
      return expected;
    });

    // Act
    const result = await enhanced.executeSkill('alpha');

    // Assert
    expect(result).toBe(expected);
  });

  it('should_return_error_when_skill_name_is_not_found', async () => {
    // Arrange
    const manager = createManager({
      getSkillsForCwd: vi.fn(async () => ({ skills: [] })),
    });
    const enhanced = enhanceWithSandbox(manager);
    const context = { cwd: '/none' };

    skillExecutorState.executeMock.mockImplementation(() => {
      throw new Error('execute should not be called');
    });

    // Act
    const result = await enhanced.executeSkill('missing', context);

    // Assert
    expect(result).toEqual({
      success: false,
      error: 'Skill not found: missing',
      data: null,
      metrics: {},
    });
  });

  it('should_return_error_when_skill_name_is_whitespace_and_not_found', async () => {
    // Arrange
    const manager = createManager({
      getSkillsForCwd: vi.fn(async () => ({ skills: [] })),
    });
    const enhanced = enhanceWithSandbox(manager);
    const context = { cwd: '/none' };

    skillExecutorState.executeMock.mockImplementation(() => {
      throw new Error('execute should not be called');
    });

    // Act
    const result = await enhanced.executeSkill('   ', context);

    // Assert
    expect(result).toEqual({
      success: false,
      error: 'Skill not found:    ',
      data: null,
      metrics: {},
    });
  });

  it('should_return_executor_result_when_remote_skill_body_is_loaded', async () => {
    // Arrange
    const skill = { metadata: { name: 'remote', scope: 'remote' }, body: null };
    const remoteProvider = {
      loadSkillBody: vi.fn(async (name) => {
        if (name !== 'remote') throw new Error('unexpected skill name');
        return 'remote body';
      }),
    };
    const manager = createManager({
      remoteProvider,
      getSkillsForCwd: vi.fn(async () => ({ skills: [skill] })),
    });
    const enhanced = enhanceWithSandbox(manager);
    const expected = { success: true };

    skillExecutorState.executeMock.mockImplementation(async (skillArg) => {
      if (skillArg.body !== 'remote body') throw new Error('remote body not loaded');
      return expected;
    });

    // Act
    const result = await enhanced.executeSkill('remote', { cwd: '/remote' });

    // Assert
    expect(result).toBe(expected);
  });

  it('should_return_executor_result_when_remote_skill_has_null_body_and_no_loader', async () => {
    // Arrange
    const skill = { metadata: { name: 'remote', scope: 'remote' }, body: null };
    const manager = createManager({
      remoteProvider: {},
      getSkillsForCwd: vi.fn(async () => ({ skills: [skill] })),
    });
    const enhanced = enhanceWithSandbox(manager);
    const expected = { success: true };

    skillExecutorState.executeMock.mockImplementation(async (skillArg) => {
      if (skillArg.body !== null) throw new Error('expected null body');
      return expected;
    });

    // Act
    const result = await enhanced.executeSkill('remote', { cwd: '/remote' });

    // Assert
    expect(result).toBe(expected);
  });

  it('should_return_error_when_remote_skill_body_load_fails', async () => {
    // Arrange
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

    skillExecutorState.executeMock.mockImplementation(() => {
      throw new Error('execute should not be called');
    });

    // Act
    const result = await enhanced.executeSkill('remote', { cwd: '/remote' });

    // Assert
    expect(result).toEqual({
      success: false,
      error: 'Failed to load remote skill: boom',
      data: null,
      metrics: {},
    });
  });

  it('should_return_executor_executeMany_result_when_batch_includes_missing_names', async () => {
    // Arrange
    const skillA = { metadata: { name: 'alpha' }, body: 'a' };
    const skillB = { metadata: { name: 'beta' }, body: 'b' };
    const context = { cwd: '/batch' };
    const manager = createManager({
      getSkillsForCwd: vi.fn(async (cwd) => {
        if (cwd !== '/batch') throw new Error('unexpected cwd');
        return { skills: [skillA, skillB] };
      }),
    });
    const enhanced = enhanceWithSandbox(manager);
    const expected = [{ success: true }];

    skillExecutorState.executeManyMock.mockImplementation(async (skillsArg, contextArg) => {
      if (skillsArg.length !== 2 || skillsArg[0] !== skillA || skillsArg[1] !== skillB) {
        throw new Error('unexpected skills');
      }
      if (contextArg !== context) throw new Error('unexpected context');
      return expected;
    });

    // Act
    const result = await enhanced.executeSkills(['alpha', 'missing', 'beta'], context);

    // Assert
    expect(result).toBe(expected);
  });

  it('should_return_executor_executeMany_result_when_skillNames_is_empty_array', async () => {
    // Arrange
    const manager = createManager({
      getSkillsForCwd: vi.fn(async () => ({ skills: [] })),
    });
    const enhanced = enhanceWithSandbox(manager);
    const expected = [];

    skillExecutorState.executeManyMock.mockImplementation(async (skillsArg) => {
      if (!Array.isArray(skillsArg) || skillsArg.length !== 0) throw new Error('unexpected skills');
      return expected;
    });

    // Act
    const result = await enhanced.executeSkills([], { cwd: '/empty' });

    // Assert
    expect(result).toBe(expected);
  });

  it('should_throw_TypeError_when_skillNames_is_not_an_array', async () => {
    // Arrange
    const manager = createManager();
    const enhanced = enhanceWithSandbox(manager);

    // Act
    const promise = enhanced.executeSkills({});

    // Assert
    await expect(promise).rejects.toThrow(TypeError);
  });

  it('should_support_concurrent_executeSkill_calls_when_called_in_parallel', async () => {
    // Arrange
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

    // Act
    const results = await Promise.all([
      enhanced.executeSkill('alpha', { cwd: '/a' }),
      enhanced.executeSkill('beta', { cwd: '/b' }),
    ]);

    // Assert
    expect(results).toEqual([
      { success: true, name: 'alpha', cwd: '/a' },
      { success: true, name: 'beta', cwd: '/b' },
    ]);
  });

  it('should_support_rapid_consecutive_executeSkill_calls', async () => {
    // Arrange
    const skillA = { metadata: { name: 'alpha' }, body: 'a' };
    const skillB = { metadata: { name: 'beta' }, body: 'b' };
    const manager = createManager({
      getSkillsForCwd: vi.fn(async () => ({ skills: [skillA, skillB] })),
    });
    const enhanced = enhanceWithSandbox(manager);

    skillExecutorState.executeMock.mockResolvedValue({ success: true });

    // Act
    await enhanced.executeSkill('alpha', { cwd: '/fast' });
    await enhanced.executeSkill('beta', { cwd: '/fast2' });

    // Assert
    expect(skillExecutorState.executeMock).toHaveBeenCalledTimes(2);
  });
});

describe('createSandboxedSkillsManager', () => {
  it('should_construct_SkillsManager_with_selected_options_when_called', async () => {
    // Arrange
    const remoteProvider = { id: 'remote' };

    // Act
    await createSandboxedSkillsManager({
      homeDir: '/home/user',
      manifestUrl: 'https://example.com/manifest',
      remoteProvider,
      cacheTtlMs: 0,
      cacheMaxEntries: Number.MAX_SAFE_INTEGER,
    });

    // Assert
    expect(skillsManagerState.constructorMock).toHaveBeenCalledWith({
      homeDir: '/home/user',
      manifestUrl: 'https://example.com/manifest',
      remoteProvider,
      cacheTtlMs: 0,
      cacheMaxEntries: Number.MAX_SAFE_INTEGER,
    });
  });

  it('should_add_executeSkill_when_createSandboxedSkillsManager_resolves', async () => {
    // Arrange

    // Act
    const manager = await createSandboxedSkillsManager({});

    // Assert
    expect(typeof manager.executeSkill).toBe('function');
  });

  it('should_construct_SkillExecutor_with_kernel_and_trustChecker_when_createSandboxedSkillsManager_called', async () => {
    // Arrange
    const kernel = { id: 'kernel' };
    const trustChecker = vi.fn();

    // Act
    await createSandboxedSkillsManager({ kernel, trustChecker });

    // Assert
    expect(skillExecutorState.constructorMock).toHaveBeenCalledWith({ kernel, trustChecker });
  });

  it('should_pass_through_string_cache_options_when_values_are_strings', async () => {
    // Arrange

    // Act
    await createSandboxedSkillsManager({
      cacheTtlMs: '123',
      cacheMaxEntries: '-1',
    });

    // Assert
    expect(skillsManagerState.constructorMock).toHaveBeenCalledWith({
      homeDir: undefined,
      manifestUrl: undefined,
      remoteProvider: undefined,
      cacheTtlMs: '123',
      cacheMaxEntries: '-1',
    });
  });

  it('should_reject_when_options_is_null', async () => {
    // Arrange

    // Act
    const promise = createSandboxedSkillsManager(null);

    // Assert
    await expect(promise).rejects.toThrow(TypeError);
  });

  it('should_propagate_constructor_failures_from_SkillsManager', async () => {
    // Arrange
    skillsManagerState.shouldThrow = true;

    // Act
    const promise = createSandboxedSkillsManager({});

    // Assert
    await expect(promise).rejects.toThrow('manager boom');
  });
});

describe('analyzeSkillRisk', () => {
  it('should_return_safe_result_when_skillBody_has_no_dangerous_patterns', () => {
    // Arrange
    const body = 'const x = 1; function ok() { return x + 1; }';

    // Act
    const result = analyzeSkillRisk(body);

    // Assert
    expect(result).toEqual({ overallRisk: 'safe', risks: [], safe: true });
  });

  it('should_return_safe_result_when_skillBody_is_empty_string', () => {
    // Arrange
    const body = '';

    // Act
    const result = analyzeSkillRisk(body);

    // Assert
    expect(result).toEqual({ overallRisk: 'safe', risks: [], safe: true });
  });

  it('should_return_safe_result_when_skillBody_is_whitespace_string', () => {
    // Arrange
    const body = '   ';

    // Act
    const result = analyzeSkillRisk(body);

    // Assert
    expect(result).toEqual({ overallRisk: 'safe', risks: [], safe: true });
  });

  it('should_return_safe_result_when_skillBody_is_null', () => {
    // Arrange
    const body = null;

    // Act
    const result = analyzeSkillRisk(body);

    // Assert
    expect(result).toEqual({ overallRisk: 'safe', risks: [], safe: true });
  });

  it('should_return_safe_result_when_skillBody_is_undefined', () => {
    // Arrange
    const body = undefined;

    // Act
    const result = analyzeSkillRisk(body);

    // Assert
    expect(result).toEqual({ overallRisk: 'safe', risks: [], safe: true });
  });

  it('should_return_safe_result_when_skillBody_is_number_zero', () => {
    // Arrange
    const body = 0;

    // Act
    const result = analyzeSkillRisk(body);

    // Assert
    expect(result).toEqual({ overallRisk: 'safe', risks: [], safe: true });
  });

  it('should_return_low_when_skillBody_contains_fetch', () => {
    // Arrange
    const body = 'fetch(\"/api\")';

    // Act
    const result = analyzeSkillRisk(body);

    // Assert
    expect(result.overallRisk).toBe('low');
  });

  it('should_return_medium_when_skillBody_contains_dynamic_import', () => {
    // Arrange
    const body = 'await import(\"fs\")';

    // Act
    const result = analyzeSkillRisk(body);

    // Assert
    expect(result.overallRisk).toBe('medium');
  });

  it('should_return_high_when_skillBody_contains_eval', () => {
    // Arrange
    const body = 'eval(\"1+1\")';

    // Act
    const result = analyzeSkillRisk(body);

    // Assert
    expect(result.overallRisk).toBe('high');
  });

  it('should_return_critical_when_skillBody_contains_child_process', () => {
    // Arrange
    const body = 'child_process.exec(\"ls\")';

    // Act
    const result = analyzeSkillRisk(body);

    // Assert
    expect(result.overallRisk).toBe('critical');
  });

  it('should_return_high_when_skillBody_contains_prototype_manipulation', () => {
    // Arrange
    const body = 'obj.__proto__ = { polluted: true }';

    // Act
    const result = analyzeSkillRisk(body);

    // Assert
    expect(result.overallRisk).toBe('high');
  });

  it('should_include_risk_metadata_when_pattern_matches', () => {
    // Arrange
    const body = 'eval(\"1\")';

    // Act
    const result = analyzeSkillRisk(body);

    // Assert
    expect(result).toEqual({
      overallRisk: 'high',
      risks: [{ risk: 'high', desc: 'Uses eval()', pattern: 'eval\\s*\\(' }],
      safe: false,
    });
  });

  it('should_return_critical_when_multiple_patterns_include_child_process', () => {
    // Arrange
    const body = 'fetch(\"/api\"); child_process.exec(\"ls\");';

    // Act
    const result = analyzeSkillRisk(body);

    // Assert
    expect(result.overallRisk).toBe('critical');
  });

  it('should_handle_long_strings_without_throwing', () => {
    // Arrange
    const body = 'a'.repeat(200000) + ' XMLHttpRequest ';

    // Act
    const result = analyzeSkillRisk(body);

    // Assert
    expect(result.overallRisk).toBe('low');
  });
});