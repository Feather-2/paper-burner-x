import { describe, it, expect, vi, beforeEach } from 'vitest';

const sharedMocks = vi.hoisted(() => ({
  isNodeLike: vi.fn(),
}));

const fsMocks = vi.hoisted(() => ({
  access: vi.fn(),
  readFile: vi.fn(),
}));

const pathMocks = vi.hoisted(() => ({
  join: vi.fn(),
}));

vi.mock('../../../../js/agents/shared/index.js', () => ({
  isNodeLike: sharedMocks.isNodeLike,
}));

vi.mock('node:fs/promises', () => ({
  access: fsMocks.access,
  readFile: fsMocks.readFile,
}));

vi.mock('node:path', () => ({
  join: pathMocks.join,
}));

const MODULE_PATH = '../../../../js/agents/sdk/config-loader.js';

const loadModule = async () => await import(MODULE_PATH);

const defaultJoin = (...parts) => parts.map((part) => String(part)).join('/');

beforeEach(() => {
  vi.resetModules();
  sharedMocks.isNodeLike.mockReset();
  fsMocks.access.mockReset();
  fsMocks.readFile.mockReset();
  pathMocks.join.mockReset();

  sharedMocks.isNodeLike.mockReturnValue(true);
  fsMocks.access.mockResolvedValue(undefined);
  fsMocks.readFile.mockResolvedValue('');
  pathMocks.join.mockImplementation(defaultJoin);
});

describe('loadAgentConfig', () => {
  it.each([
    ['undefined root', undefined, '/.agent/agent.md'],
    ['null root', null, '/.agent/agent.md'],
    ['empty string', '', '/.agent/agent.md'],
    ['whitespace string', '   ', '   /.agent/agent.md'],
    ['empty array', [], '/.agent/agent.md'],
    ['empty object', {}, '[object Object]/.agent/agent.md'],
    ['zero', 0, '/.agent/agent.md'],
    ['negative one', -1, '-1/.agent/agent.md'],
    ['max safe integer', Number.MAX_SAFE_INTEGER, '9007199254740991/.agent/agent.md'],
    ['numeric string', '123', '123/.agent/agent.md'],
    ['trailing slash', '/tmp/root/', '/tmp/root/.agent/agent.md'],
  ])('returns defaults when not node-like: %s', async (_label, projectRoot, expectedPath) => {
    sharedMocks.isNodeLike.mockReturnValue(false);
    const { loadAgentConfig } = await loadModule();

    const result = await loadAgentConfig(projectRoot);

    expect(result.instructions).toBe('');
    expect(result.skills).toEqual([]);
    expect(result.model).toBeNull();
    expect(result.hooks).toEqual([]);
    expect(result._loaded).toBe(false);
    expect(result._path).toBe(expectedPath);
    expect(result._raw).toBeUndefined();
    expect(fsMocks.access).not.toHaveBeenCalled();
    expect(fsMocks.readFile).not.toHaveBeenCalled();
    expect(pathMocks.join).not.toHaveBeenCalled();
  });

  it('loads frontmatter and instructions when config exists', async () => {
    const content = [
      '---',
      'skills: [search-docs, write-report]',
      'model: gpt-4',
      'hooks:',
      '  - ./hooks/audit.js',
      '  - ./hooks/extra.js',
      '# comment line',
      '---',
      'Use this agent.',
    ].join('\n');

    fsMocks.readFile.mockResolvedValue(content);
    const { loadAgentConfig } = await loadModule();

    const result = await loadAgentConfig('/project');

    expect(pathMocks.join).toHaveBeenCalledWith('/project', '.agent', 'agent.md');
    expect(fsMocks.access).toHaveBeenCalledWith('/project/.agent/agent.md');
    expect(fsMocks.readFile).toHaveBeenCalledWith('/project/.agent/agent.md', 'utf-8');
    expect(result.instructions).toBe('Use this agent.');
    expect(result.skills).toEqual(['search-docs', 'write-report']);
    expect(result.model).toBe('gpt-4');
    expect(result.hooks).toEqual(['./hooks/audit.js', './hooks/extra.js']);
    expect(result._loaded).toBe(true);
    expect(result._path).toBe('/project/.agent/agent.md');
    expect(result._raw).toEqual({
      skills: ['search-docs', 'write-report'],
      model: 'gpt-4',
      hooks: ['./hooks/audit.js', './hooks/extra.js'],
    });
  });

  it('ignores non-array skills and hooks values', async () => {
    const content = ['---', 'skills: nope', 'hooks: 123', 'model: gpt-4', '---', 'Hi'].join(
      '\n'
    );

    fsMocks.readFile.mockResolvedValue(content);
    const { loadAgentConfig } = await loadModule();

    const result = await loadAgentConfig('/project');

    expect(result.instructions).toBe('Hi');
    expect(result.skills).toEqual([]);
    expect(result.hooks).toEqual([]);
    expect(result.model).toBe('gpt-4');
    expect(result._raw).toEqual({ skills: 'nope', hooks: '123', model: 'gpt-4' });
  });

  it.each(['ENOENT', 'ENOTDIR'])(
    'returns defaults when config is missing (%s) without warning',
    async (code) => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      fsMocks.access.mockRejectedValue(Object.assign(new Error('missing'), { code }));
      const { loadAgentConfig } = await loadModule();

      const result = await loadAgentConfig('/project');

      expect(result._loaded).toBe(false);
      expect(result._path).toBe('/project/.agent/agent.md');
      expect(result._raw).toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalled();
      expect(fsMocks.readFile).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    }
  );

  it('logs a warning for unexpected errors', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fsMocks.access.mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }));
    const { loadAgentConfig } = await loadModule();

    const result = await loadAgentConfig('/project');

    expect(result._loaded).toBe(false);
    expect(result._path).toBe('/project/.agent/agent.md');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to load /project/.agent/agent.md')
    );
    warnSpy.mockRestore();
  });

  it('handles concurrent calls with different files', async () => {
    const contentByPath = new Map([
      [
        '/project-a/.agent/agent.md',
        ['---', 'model: gpt-4', '---', 'Project A'].join('\n'),
      ],
      [
        '/project-b/.agent/agent.md',
        ['---', 'model: gpt-3.5', '---', 'Project B'].join('\n'),
      ],
    ]);

    fsMocks.readFile.mockImplementation(async (path) => contentByPath.get(path));
    const { loadAgentConfig } = await loadModule();

    const [first, second] = await Promise.all([
      loadAgentConfig('/project-a'),
      loadAgentConfig('/project-b'),
    ]);

    expect(first.instructions).toBe('Project A');
    expect(first.model).toBe('gpt-4');
    expect(second.instructions).toBe('Project B');
    expect(second.model).toBe('gpt-3.5');
    expect(fsMocks.readFile).toHaveBeenCalledTimes(2);
  });

  it('handles rapid successive calls', async () => {
    fsMocks.readFile
      .mockResolvedValueOnce(['---', 'model: gpt-4', '---', 'First'].join('\n'))
      .mockResolvedValueOnce(['---', 'model: gpt-4', '---', 'Second'].join('\n'));
    const { loadAgentConfig } = await loadModule();

    const first = await loadAgentConfig('/project');
    const second = await loadAgentConfig('/project');

    expect(first.instructions).toBe('First');
    expect(second.instructions).toBe('Second');
    expect(fsMocks.readFile).toHaveBeenCalledTimes(2);
  });

  it('handles large config files with long instructions', async () => {
    const longBody = 'x'.repeat(200000);
    const content = ['---', 'model: 0', '---', longBody].join('\n');

    fsMocks.readFile.mockResolvedValue(content);
    const { loadAgentConfig } = await loadModule();

    const result = await loadAgentConfig('/project');

    expect(result.instructions.length).toBe(longBody.length);
    expect(result.instructions.startsWith('x')).toBe(true);
    expect(result.model).toBe('0');
  });
});

describe('mergeConfigs', () => {
  it('merges project over global and de-duplicates skills', async () => {
    const { mergeConfigs } = await loadModule();
    const project = {
      instructions: 'project',
      skills: ['a', 'b'],
      model: 'm1',
      hooks: ['p1'],
    };
    const global = {
      instructions: 'global',
      skills: ['b', 'c'],
      model: 'm2',
      hooks: ['g1'],
    };

    const result = mergeConfigs(project, global);

    expect(result.instructions).toBe('project');
    expect(result.skills).toEqual(['a', 'b', 'c']);
    expect(result.model).toBe('m1');
    expect(result.hooks).toEqual(['g1', 'p1']);
  });

  it('falls back to global values when project values are empty', async () => {
    const { mergeConfigs } = await loadModule();
    const project = { instructions: '', skills: [], model: null, hooks: [] };
    const global = {
      instructions: 'global',
      skills: ['g1'],
      model: 'gpt-4',
      hooks: ['g-hook'],
    };

    const result = mergeConfigs(project, global);

    expect(result.instructions).toBe('global');
    expect(result.skills).toEqual(['g1']);
    expect(result.model).toBe('gpt-4');
    expect(result.hooks).toEqual(['g-hook']);
  });

  it('returns defaults when inputs are empty objects or nullish fields', async () => {
    const { mergeConfigs } = await loadModule();
    const result = mergeConfigs(
      { instructions: null, skills: [], model: undefined, hooks: [] },
      { instructions: undefined, skills: [], model: null, hooks: [] }
    );
    const emptyResult = mergeConfigs({}, {});

    expect(result.instructions).toBe('');
    expect(result.skills).toEqual([]);
    expect(result.model).toBeNull();
    expect(result.hooks).toEqual([]);
    expect(emptyResult).toEqual({
      instructions: '',
      skills: [],
      model: null,
      hooks: [],
    });
  });

  it('throws when skills is a non-iterable object', async () => {
    const { mergeConfigs } = await loadModule();

    expect(() => mergeConfigs({ skills: {} }, { skills: [] })).toThrow(TypeError);
  });

  it('handles rapid consecutive merges', async () => {
    const { mergeConfigs } = await loadModule();
    const inputs = [
      [{ instructions: 'a', skills: ['a'], model: 'm1', hooks: [] }, {}],
      [{ instructions: 'b', skills: ['b'], model: 'm2', hooks: ['p'] }, { hooks: ['g'] }],
      [{}, { instructions: 'c', skills: ['c'], model: 'm3', hooks: ['g'] }],
    ];

    const results = inputs.map(([project, global]) => mergeConfigs(project, global));

    expect(results).toEqual([
      { instructions: 'a', skills: ['a'], model: 'm1', hooks: [] },
      { instructions: 'b', skills: ['b'], model: 'm2', hooks: ['g', 'p'] },
      { instructions: 'c', skills: ['c'], model: 'm3', hooks: ['g'] },
    ]);
  });
});

describe('default', () => {
  it('exposes loadAgentConfig, mergeConfigs, and parseFrontmatter', async () => {
    const module = await loadModule();

    expect(module.default).toBeDefined();
    expect(module.default.loadAgentConfig).toBe(module.loadAgentConfig);
    expect(module.default.mergeConfigs).toBe(module.mergeConfigs);
    expect(typeof module.default.parseFrontmatter).toBe('function');
  });
});

describe('default.parseFrontmatter', () => {
  it('parses frontmatter arrays and returns trimmed body', async () => {
    const { default: configLoader } = await loadModule();
    const content = [
      '---',
      'skills: [search-docs, write-report]',
      'model: gpt-4',
      'hooks:',
      '  - ./hooks/audit.js',
      '  - ./hooks/extra.js',
      '# comment',
      '---',
      ' Use this agent. ',
    ].join('\n');

    const { frontmatter, body } = configLoader.parseFrontmatter(content);

    expect(frontmatter).toEqual({
      skills: ['search-docs', 'write-report'],
      model: 'gpt-4',
      hooks: ['./hooks/audit.js', './hooks/extra.js'],
    });
    expect(body).toBe('Use this agent.');
  });

  it('returns empty frontmatter when no YAML block is present', async () => {
    const { default: configLoader } = await loadModule();

    const { frontmatter, body } = configLoader.parseFrontmatter('Just text\n');

    expect(frontmatter).toEqual({});
    expect(body).toBe('Just text');
  });

  it('handles numeric-like values and whitespace-only fields', async () => {
    const { default: configLoader } = await loadModule();
    const content = [
      '---',
      'model: 0',
      'skills: [0, -1, 9007199254740991, 42]',
      'hooks:',
      '  - 0',
      '  - -1',
      '  - 9007199254740991',
      'empty:   ',
      '---',
      '   ',
    ].join('\n');

    const { frontmatter, body } = configLoader.parseFrontmatter(content);

    expect(frontmatter.model).toBe('0');
    expect(frontmatter.skills).toEqual(['0', '-1', '9007199254740991', '42']);
    expect(frontmatter.hooks).toEqual(['0', '-1', '9007199254740991']);
    expect(frontmatter.empty).toBeUndefined();
    expect(body).toBe('');
  });

  it('tolerates deep nesting and long bodies', async () => {
    const { default: configLoader } = await loadModule();
    const deepNested = JSON.stringify({ level1: { level2: { level3: { value: 'x' } } } });
    const longBody = `${deepNested}\n${'x'.repeat(120000)}`;
    const content = [
      '---',
      'skills:',
      '  - deep',
      'nested:',
      '  level1:',
      '    level2:',
      '      level3:',
      '        value: x',
      '---',
      longBody,
    ].join('\n');

    const { frontmatter, body } = configLoader.parseFrontmatter(content);

    expect(frontmatter.skills).toEqual(['deep']);
    expect(body.startsWith(deepNested)).toBe(true);
    expect(body.length).toBe(longBody.length);
  });
});
