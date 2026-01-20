import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../../js/agents/runtime/safety/tool-restrictions.js', async () => {
  const actual = await vi.importActual(
    '../../../../../js/agents/runtime/safety/tool-restrictions.js',
  );
  return {
    ...actual,
    normalizeToolRestrictions: vi.fn(actual.normalizeToolRestrictions),
    evaluateToolRestrictions: vi.fn(actual.evaluateToolRestrictions),
  };
});

vi.mock('../../../../../js/agents/shared/index.js', async () => {
  const actual = await vi.importActual('../../../../../js/agents/shared/index.js');
  return {
    ...actual,
    toNonEmptyString: vi.fn(actual.toNonEmptyString),
    isPlainObject: vi.fn(actual.isPlainObject),
  };
});

import ToolPermissions, {
  PermissionLevel,
  getPresetRestrictions,
  mergeRestrictions,
} from '../../../../../js/agents/runtime/safety/tool-permissions.js';
import {
  normalizeToolRestrictions,
  evaluateToolRestrictions,
} from '../../../../../js/agents/runtime/safety/tool-restrictions.js';
import { toNonEmptyString, isPlainObject } from '../../../../../js/agents/shared/index.js';

beforeEach(async () => {
  vi.clearAllMocks();
  const actualToolRestrictions = await vi.importActual(
    '../../../../../js/agents/runtime/safety/tool-restrictions.js',
  );
  const actualShared = await vi.importActual('../../../../../js/agents/shared/index.js');

  normalizeToolRestrictions.mockImplementation(
    actualToolRestrictions.normalizeToolRestrictions,
  );
  evaluateToolRestrictions.mockImplementation(
    actualToolRestrictions.evaluateToolRestrictions,
  );
  toNonEmptyString.mockImplementation(actualShared.toNonEmptyString);
  isPlainObject.mockImplementation(actualShared.isPlainObject);
});

describe('PermissionLevel', () => {
  it('exposes expected string values', () => {
    expect(PermissionLevel).toEqual({
      READONLY: 'readonly',
      STANDARD: 'standard',
      ELEVATED: 'elevated',
      CUSTOM: 'custom',
    });
  });
});

describe('getPresetRestrictions', () => {
  it('returns readonly restrictions for readonly aliases', () => {
    const restrictions = getPresetRestrictions('READ-ONLY');

    expect(restrictions).not.toBeNull();
    expect(restrictions.blockedTools).toContain('write');
    expect(restrictions.bash.allowedCommands).toContain('ls');
    expect(restrictions.bash.toolNames).toEqual(['bash', 'shell', 'exec']);
  });

  it('returns standard restrictions for standard/default aliases', () => {
    const restrictions = getPresetRestrictions('default');

    expect(restrictions.bash.blockedCommands).toContain('rm -rf /');
    expect(restrictions.bash.toolNames).toEqual(['bash', 'shell', 'exec']);
  });

  it('returns elevated restrictions for elevated/admin aliases', () => {
    const restrictions = getPresetRestrictions('ADMIN');

    expect(restrictions.bash.blockedCommands).toContain('mkfs.*');
    expect(restrictions.bash.toolNames).toEqual(['bash', 'shell', 'exec']);
  });

  it('returns null for custom/none levels', () => {
    expect(getPresetRestrictions('custom')).toBeNull();
    expect(getPresetRestrictions('none')).toBeNull();
  });

  it('defaults to standard for empty, invalid, or numeric-like inputs', () => {
    const standard = getPresetRestrictions('standard');
    const longLevel = 'x'.repeat(5000);
    const cases = [
      null,
      undefined,
      '',
      '   \n\t',
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      '0',
      {},
      [],
      'unknown',
      longLevel,
    ];

    for (const value of cases) {
      expect(getPresetRestrictions(value)).toEqual(standard);
    }
  });
});

describe('mergeRestrictions', () => {
  it('returns null when inputs normalize to empty', () => {
    expect(mergeRestrictions(null, undefined)).toBeNull();
    expect(mergeRestrictions({}, {})).toBeNull();
    expect(mergeRestrictions([], [])).toBeNull();
  });

  it('merges allowedTools and blockedTools lists', () => {
    const merged = mergeRestrictions(
      { allowedTools: ['read'], blockedTools: ['write'] },
      { allowedTools: ['glob'], blockedTools: ['delete'] },
    );

    expect(merged.allowedTools).toEqual(['read', 'glob']);
    expect(merged.blockedTools).toEqual(['write', 'delete']);
  });

  it('overrides allowedCommands when override provides a non-empty list', () => {
    const merged = mergeRestrictions(
      { bash: { allowedCommands: ['ls'], blockedCommands: ['rm'] } },
      { bash: { allowedCommands: ['pwd'] } },
    );

    expect(merged.bash.allowedCommands).toEqual(['pwd']);
    expect(merged.bash.blockedCommands).toEqual(['rm']);
  });

  it('keeps base allowedCommands when override omits them', () => {
    const merged = mergeRestrictions(
      { bash: { allowedCommands: ['ls'] } },
      { bash: { blockedCommands: ['rm'] } },
    );

    expect(merged.bash.allowedCommands).toEqual(['ls']);
    expect(merged.bash.blockedCommands).toEqual(['rm']);
  });

  it('merges and de-duplicates bash toolNames', () => {
    const merged = mergeRestrictions(
      { bash: { blockedCommands: ['rm'], toolNames: ['bash', 'shell'] } },
      { bash: { toolNames: ['exec', 'bash'] } },
    );

    expect(merged.bash.toolNames).toEqual(['bash', 'shell', 'exec']);
  });

  it('defaults bash toolNames to bash when commands are present', () => {
    const merged = mergeRestrictions({ bash: { allowedCommands: ['ls'] } }, null);

    expect(merged.bash.toolNames).toEqual(['bash']);
  });

  it('normalizes string lists for allowedTools', () => {
    const merged = mergeRestrictions({ allowedTools: 'read, write' }, null);

    expect(merged.allowedTools).toEqual(['read', 'write']);
  });

  it('handles large restriction lists without dropping entries', () => {
    const list = Array.from({ length: 2000 }, (_, i) => `tool-${i}`);
    const merged = mergeRestrictions(
      { allowedTools: list.slice(0, 1000) },
      { allowedTools: list.slice(1000) },
    );

    expect(merged.allowedTools.length).toBe(2000);
    expect(merged.allowedTools[0]).toBe('tool-0');
    expect(merged.allowedTools[1999]).toBe('tool-1999');
  });
});

describe('ToolPermissions', () => {
  describe('static factories', () => {
    it('creates expected levels', () => {
      expect(ToolPermissions.readonly().getLevel()).toBe('readonly');
      expect(ToolPermissions.standard().getLevel()).toBe('standard');
      expect(ToolPermissions.elevated().getLevel()).toBe('elevated');
      expect(ToolPermissions.custom().getLevel()).toBe('custom');
    });
  });

  describe('constructor and getters', () => {
    it('defaults to standard for non-plain config values', () => {
      const cases = [null, undefined, 0, 'config', [], new Date()];

      for (const value of cases) {
        const perm = new ToolPermissions(value);
        expect(perm.getLevel()).toBe('standard');
      }
    });

    it('normalizes level aliases', () => {
      expect(new ToolPermissions({ level: 'READ-ONLY' }).getLevel()).toBe('readonly');
      expect(new ToolPermissions({ level: 'Admin' }).getLevel()).toBe('elevated');
      expect(new ToolPermissions({ level: 'none' }).getLevel()).toBe('custom');
    });

    it('merges preset and custom restrictions', () => {
      const perm = new ToolPermissions({
        level: 'readonly',
        restrictions: { blockedTools: ['custom_tool'] },
      });
      const restrictions = perm.getRestrictions();

      expect(restrictions.blockedTools).toContain('write');
      expect(restrictions.blockedTools).toContain('custom_tool');
    });

    it('treats strict as true only for boolean true', () => {
      expect(new ToolPermissions({ strict: true }).toJSON().strict).toBe(true);
      expect(new ToolPermissions({ strict: 'true' }).toJSON().strict).toBe(false);
    });
  });

  describe('check', () => {
    it('short-circuits when no restrictions and not strict', () => {
      const perm = ToolPermissions.custom();
      const result = perm.check('anything', null);

      expect(result).toEqual({ allowed: true });
      expect(evaluateToolRestrictions).not.toHaveBeenCalled();
    });

    it('blocks readonly write tools', () => {
      const perm = ToolPermissions.readonly();
      const result = perm.check('write', null);

      expect(result.allowed).toBe(false);
      expect(evaluateToolRestrictions).toHaveBeenCalledTimes(1);
    });

    it('allows tools not on the readonly blocklist', () => {
      const perm = ToolPermissions.readonly();
      const result = perm.check('read', null);

      expect(result.allowed).toBe(true);
    });

    it('blocks dangerous bash in standard mode', () => {
      const perm = ToolPermissions.standard();
      const result = perm.check('bash', 'rm -rf /');

      expect(result.allowed).toBe(false);
    });

    it('strict mode rejects tools not in the allowlist when evaluator allows', () => {
      evaluateToolRestrictions.mockReturnValue({ allowed: true });
      const perm = new ToolPermissions({
        level: 'custom',
        restrictions: { allowedTools: ['read'] },
        strict: true,
      });

      const result = perm.check('write', null);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('tool_not_in_allowlist');
    });

    it('strict mode accepts wildcard allowlist patterns', () => {
      evaluateToolRestrictions.mockReturnValue({ allowed: true });
      const perm = new ToolPermissions({
        level: 'custom',
        restrictions: { allowedTools: ['re*'] },
        strict: true,
      });

      const result = perm.check('read', null);
      expect(result.allowed).toBe(true);
    });

    it('handles rapid successive checks consistently', () => {
      const perm = ToolPermissions.standard();
      const results = Array.from({ length: 5 }, () => perm.check('write', null));

      expect(results.every((entry) => entry.allowed)).toBe(true);
    });

    it('handles concurrent checks without shared-state issues', async () => {
      const perm = ToolPermissions.custom();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => Promise.resolve(perm.check('read', null))),
      );

      expect(results.every((entry) => entry.allowed)).toBe(true);
    });
  });

  describe('mutation helpers', () => {
    it('allow ignores falsy values and is chainable', () => {
      const perm = ToolPermissions.custom();
      const chained = perm.allow(['read', '', null, undefined]);

      expect(chained).toBe(perm);
      expect(perm.getRestrictions().allowedTools).toEqual(['read']);
    });

    it('block keeps truthy numeric boundaries and drops zero', () => {
      const perm = ToolPermissions.custom().block([0, -1, Number.MAX_SAFE_INTEGER]);

      expect(perm.getRestrictions().blockedTools).toEqual([-1, Number.MAX_SAFE_INTEGER]);
    });

    it('allowBash appends commands and defaults toolNames', () => {
      const perm = ToolPermissions.custom().allowBash('ls');
      const restrictions = perm.getRestrictions();

      expect(restrictions.bash.allowedCommands).toEqual(['ls']);
      expect(restrictions.bash.toolNames).toEqual(['bash']);
    });

    it('blockBash supports long command strings', () => {
      const longCommand = 'x'.repeat(10000);
      const perm = ToolPermissions.custom().blockBash(longCommand);

      expect(perm.getRestrictions().bash.blockedCommands).toEqual([longCommand]);
    });

    it('accepts object input for commands without throwing', () => {
      const perm = ToolPermissions.custom();
      const commandObject = { cmd: 'ls' };

      expect(() => perm.allowBash(commandObject)).not.toThrow();
      expect(perm.getRestrictions().bash.allowedCommands).toContain(commandObject);
    });
  });

  describe('createHook', () => {
    it('returns null when checks allow the tool', () => {
      evaluateToolRestrictions.mockReturnValue({ allowed: true });
      const hook = ToolPermissions.standard().createHook();

      expect(hook({ tool: 'bash', params: { command: 'ls' } })).toBeNull();
    });

    it('returns skip payload when checks deny the tool', () => {
      evaluateToolRestrictions.mockReturnValue({
        allowed: false,
        reason: 'blocked',
        policy: { type: 'mock' },
      });
      const hook = ToolPermissions.standard().createHook();

      const result = hook({ tool: 'bash', params: { command: 'rm -rf /' } });
      expect(result).toEqual({
        skip: true,
        value: { ok: false, error: 'blocked', policy: { type: 'mock' } },
      });
    });

    it('extracts command from params.command, params.cmd, and string params', () => {
      const seen = [];
      evaluateToolRestrictions.mockImplementation(({ command }) => {
        seen.push(command);
        return { allowed: true };
      });
      const hook = ToolPermissions.standard().createHook();

      hook({ tool: 'bash', params: { command: 'ls' } });
      hook({ tool: 'bash', params: { cmd: 'pwd' } });
      hook({ tool: 'bash', params: 'whoami' });

      expect(seen).toEqual(['ls', 'pwd', 'whoami']);
    });

    it('ignores deeply nested command values', () => {
      let captured = 'unset';
      evaluateToolRestrictions.mockImplementation(({ command }) => {
        captured = command;
        return { allowed: true };
      });
      const hook = ToolPermissions.standard().createHook();

      hook({ tool: 'bash', params: { nested: { cmd: 'rm -rf /' } } });

      expect(captured).toBeNull();
    });
  });

  describe('serialization', () => {
    it('round-trips configuration through toJSON/fromJSON', () => {
      const original = new ToolPermissions({
        level: 'readonly',
        restrictions: { blockedTools: ['extra_tool'] },
        strict: true,
      });
      const json = original.toJSON();
      const restored = ToolPermissions.fromJSON(json);

      expect(restored.getLevel()).toBe('readonly');
      expect(restored.toJSON().strict).toBe(true);
      expect(restored.getRestrictions().blockedTools).toContain('extra_tool');
    });

    it('fromJSON falls back on invalid input', () => {
      const restored = ToolPermissions.fromJSON(0);

      expect(restored.getLevel()).toBe('standard');
    });
  });
});
