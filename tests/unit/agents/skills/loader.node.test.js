// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SkillScope } from '../../../../js/agents/skills/model.js';

const MODULE_PATH = '../../../../js/agents/skills/loader.node.js';

const REPO_ROOT = '/repo';
const HOME_DIR = '/home/testuser';

const {
  fsMock,
  resetFs,
  addDir,
  addFile,
  setReaddirError,
} = vi.hoisted(() => {
  const state = {
    dirs: new Set(),
    files: new Map(),
    readdirErrors: new Map(),
  };

  function normalizeFsPath(input) {
    const raw = typeof input === 'string' ? input : String(input);
    const slashes = raw.replace(/\\/g, '/');
    if (slashes === '/') return '/';
    return slashes.replace(/\/+$/g, '') || '/';
  }

  function ensureDir(dirPath) {
    const normalized = normalizeFsPath(dirPath);
    state.dirs.add('/');
    if (normalized === '/') return;
    const parts = normalized.split('/').filter(Boolean);
    let current = '';
    for (const part of parts) {
      current += `/${part}`;
      state.dirs.add(current);
    }
  }

  function addDir(dirPath) {
    ensureDir(dirPath);
  }

  function addFile(filePath, content) {
    const normalized = normalizeFsPath(filePath);
    const parent = normalized.split('/').slice(0, -1).join('/') || '/';
    ensureDir(parent);
    state.files.set(normalized, String(content));
  }

  function setReaddirError(dirPath, error) {
    const normalized = normalizeFsPath(dirPath);
    state.readdirErrors.set(normalized, error);
  }

  function createFsError(code, syscall, filePath) {
    const err = new Error(`${code}: ${syscall} '${filePath}'`);
    err.code = code;
    err.syscall = syscall;
    err.path = filePath;
    return err;
  }

  function listChildren(dirPath) {
    const dir = normalizeFsPath(dirPath);
    if (!state.dirs.has(dir)) throw createFsError('ENOENT', 'scandir', dir);

    const prefix = dir === '/' ? '/' : `${dir}/`;
    const names = new Set();

    for (const d of state.dirs) {
      if (d === dir) continue;
      if (!d.startsWith(prefix)) continue;
      const rest = d.slice(prefix.length);
      const seg = rest.split('/')[0];
      if (seg) names.add(seg);
    }

    for (const f of state.files.keys()) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length);
      const seg = rest.split('/')[0];
      if (seg) names.add(seg);
    }

    return [...names].sort();
  }

  function makeDirent(parent, name) {
    const full = normalizeFsPath(`${normalizeFsPath(parent)}/${name}`);
    const isDir = state.dirs.has(full);
    const isFile = state.files.has(full);

    return {
      name,
      isDirectory: () => isDir,
      isFile: () => isFile,
    };
  }

  function makeStats({ isDirectory, isFile }) {
    return {
      isDirectory: () => !!isDirectory,
      isFile: () => !!isFile,
    };
  }

  function resetFs() {
    state.dirs.clear();
    state.files.clear();
    state.readdirErrors.clear();
    state.dirs.add('/');
  }

  /** @type {any} */
  const fsMock = {
    readFile: vi.fn(async (filePath, options) => {
      const p = normalizeFsPath(filePath);
      const entry = state.files.get(p);
      if (!entry) throw createFsError('ENOENT', 'open', p);

      const encoding =
        typeof options === 'string'
          ? options
          : options && typeof options === 'object'
            ? options.encoding
            : undefined;

      if (encoding) return entry;
      return Buffer.from(entry, 'utf8');
    }),

    stat: vi.fn(async (filePath) => {
      const p = normalizeFsPath(filePath);
      if (state.files.has(p)) return makeStats({ isFile: true, isDirectory: false });
      if (state.dirs.has(p)) return makeStats({ isFile: false, isDirectory: true });
      throw createFsError('ENOENT', 'stat', p);
    }),

    readdir: vi.fn(async (dirPath, options) => {
      const dir = normalizeFsPath(dirPath);
      if (state.readdirErrors.has(dir)) throw state.readdirErrors.get(dir);

      const names = listChildren(dir);
      const withFileTypes = !!(options && typeof options === 'object' && options.withFileTypes);
      if (!withFileTypes) return names;
      return names.map((name) => makeDirent(dir, name));
    }),
  };

  return {
    fsMock,
    resetFs,
    addDir,
    addFile,
    setReaddirError,
  };
});

vi.mock('node:fs/promises', () => fsMock);

function makeSkillFile(frontmatterYaml, body = '') {
  return `---\n${frontmatterYaml}\n---\n${body}\n`;
}

function makeBasicFrontmatter(name, description) {
  return `name: ${name}\ndescription: ${description}`;
}

async function importFreshLoader() {
  vi.resetModules();
  return await import(MODULE_PATH);
}

function simplifyOutcome(outcome) {
  return {
    skills: outcome.skills.map((s) => ({
      name: s?.metadata?.name,
      description: s?.metadata?.description,
      scope: s?.metadata?.scope,
      path: s?.metadata?.path,
      priority: s?.metadata?.priority,
      bodyLen: typeof s?.body === 'string' ? s.body.length : null,
    })),
    errors: outcome.errors.map((e) => ({ path: e?.path, message: e?.message })),
  };
}

beforeEach(() => {
  resetFs();
  addDir(REPO_ROOT);
  addDir(HOME_DIR);
  addDir(`${REPO_ROOT}/.paper-burner/skills`);
  addDir(`${HOME_DIR}/.paper-burner/skills`);
  vi.clearAllMocks();
});

describe('loadSkills', () => {
  it('returns empty outcome for undefined / empty options', async () => {
    const { loadSkills } = await importFreshLoader();
    await expect(loadSkills()).resolves.toEqual({ skills: [], errors: [] });
    await expect(loadSkills({})).resolves.toEqual({ skills: [], errors: [] });
    await expect(loadSkills({ cwd: '', homeDir: '' })).resolves.toEqual({ skills: [], errors: [] });
  });

  it('loads repo+user skills, dedupes by priority (repo first), and sorts by name', async () => {
    const { loadSkills } = await importFreshLoader();

    const repoRoot = `${REPO_ROOT}/.paper-burner/skills`;
    const userRoot = `${HOME_DIR}/.paper-burner/skills`;

    addDir(`${repoRoot}/dup`);
    addFile(
      `${repoRoot}/dup/SKILL.md`,
      makeSkillFile(makeBasicFrontmatter('dup', 'from repo'), 'repo body'),
    );

    addDir(`${userRoot}/dup`);
    addFile(
      `${userRoot}/dup/SKILL.md`,
      makeSkillFile(makeBasicFrontmatter('dup', 'from user'), 'user body'),
    );

    addDir(`${userRoot}/a`);
    addFile(
      `${userRoot}/a/SKILL.md`,
      makeSkillFile(makeBasicFrontmatter('a', 'user a'), 'a body'),
    );

    addDir(`${repoRoot}/b`);
    addFile(
      `${repoRoot}/b/SKILL.md`,
      makeSkillFile(makeBasicFrontmatter('b', 'repo b'), 'b body'),
    );

    const outcome = await loadSkills({ cwd: REPO_ROOT, homeDir: HOME_DIR });
    const names = outcome.skills.map((s) => s.metadata.name);

    expect(names).toEqual(['a', 'b', 'dup']);

    const dup = outcome.skills.find((s) => s.metadata.name === 'dup');
    expect(dup?.metadata?.description).toBe('from repo');
    expect(dup?.metadata?.scope).toBe(SkillScope.REPO);
  });

  it('skips hidden files/directories while discovering skills', async () => {
    const { loadSkills } = await importFreshLoader();

    const repoRoot = `${REPO_ROOT}/.paper-burner/skills`;

    addDir(`${repoRoot}/.hidden-skill`);
    addFile(
      `${repoRoot}/.hidden-skill/SKILL.md`,
      makeSkillFile(makeBasicFrontmatter('hidden', 'should not load'), 'x'),
    );

    addFile(
      `${repoRoot}/.DS_Store`,
      'should be ignored',
    );

    addDir(`${repoRoot}/visible`);
    addFile(
      `${repoRoot}/visible/SKILL.md`,
      makeSkillFile(makeBasicFrontmatter('visible', 'loads'), 'ok'),
    );

    const outcome = await loadSkills({ cwd: REPO_ROOT, homeDir: HOME_DIR });
    const names = outcome.skills.map((s) => s.metadata.name);
    expect(names).toEqual(['visible']);
  });

  it('records directory read errors and continues with other roots', async () => {
    const { loadSkills } = await importFreshLoader();

    const repoRoot = `${REPO_ROOT}/.paper-burner/skills`;
    const userRoot = `${HOME_DIR}/.paper-burner/skills`;

    setReaddirError(repoRoot, new Error('permission denied'));

    addDir(`${userRoot}/ok`);
    addFile(
      `${userRoot}/ok/SKILL.md`,
      makeSkillFile(makeBasicFrontmatter('ok', 'from user'), 'body'),
    );

    const outcome = await loadSkills({ cwd: REPO_ROOT, homeDir: HOME_DIR });
    expect(outcome.skills.map((s) => s.metadata.name)).toEqual(['ok']);

    expect(outcome.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: repoRoot,
          message: expect.stringContaining('Failed to read dir:'),
        }),
      ]),
    );
  });

  it('records parse/validation errors for invalid SKILL.md files', async () => {
    const { loadSkills } = await importFreshLoader();

    const repoRoot = `${REPO_ROOT}/.paper-burner/skills`;
    addDir(`${repoRoot}/bad-frontmatter`);
    addFile(`${repoRoot}/bad-frontmatter/SKILL.md`, 'name: x\ndescription: y\n');

    addDir(`${repoRoot}/missing-name`);
    addFile(
      `${repoRoot}/missing-name/SKILL.md`,
      makeSkillFile('description: only', 'body'),
    );

    addDir(`${repoRoot}/too-long-name`);
    addFile(
      `${repoRoot}/too-long-name/SKILL.md`,
      makeSkillFile(makeBasicFrontmatter('n'.repeat(65), 'desc'), 'body'),
    );

    addDir(`${repoRoot}/good`);
    addFile(
      `${repoRoot}/good/SKILL.md`,
      makeSkillFile(makeBasicFrontmatter('good', 'ok'), 'ok'),
    );

    const outcome = await loadSkills({ cwd: REPO_ROOT, homeDir: HOME_DIR });
    expect(outcome.skills.map((s) => s.metadata.name)).toEqual(['good']);

    expect(outcome.errors.map((e) => e.path)).toEqual(
      expect.arrayContaining([
        `${repoRoot}/bad-frontmatter/SKILL.md`,
        `${repoRoot}/missing-name/SKILL.md`,
        `${repoRoot}/too-long-name/SKILL.md`,
      ]),
    );
  });

  it('handles deep nesting and large bodies (resource boundaries)', async () => {
    const { loadSkills } = await importFreshLoader();

    const repoRoot = `${REPO_ROOT}/.paper-burner/skills`;
    const deepParts = Array.from({ length: 40 }, (_, i) => `lvl${i}`);
    const deepDir = `${repoRoot}/${deepParts.join('/')}`;
    addDir(deepDir);

    const bigBody = 'x'.repeat(200_000);
    addFile(
      `${deepDir}/SKILL.md`,
      makeSkillFile(makeBasicFrontmatter('deep', 'big'), bigBody),
    );

    const outcome = await loadSkills({ cwd: REPO_ROOT, homeDir: HOME_DIR });
    const deep = outcome.skills.find((s) => s.metadata.name === 'deep');
    expect(deep).toBeTruthy();
    expect(deep?.body?.length).toBeGreaterThanOrEqual(200_000);
  });

  it('rejects for invalid option types (type boundaries)', async () => {
    const { loadSkills } = await importFreshLoader();

    await expect(loadSkills(null)).rejects.toThrow(TypeError);
    await expect(loadSkills({ cwd: [], homeDir: HOME_DIR })).rejects.toThrow(TypeError);
    await expect(loadSkills({ cwd: REPO_ROOT, homeDir: {} })).rejects.toThrow(TypeError);
    await expect(loadSkills({ cwd: -1, homeDir: HOME_DIR })).rejects.toThrow(TypeError);
    await expect(loadSkills({ cwd: Number.MAX_SAFE_INTEGER, homeDir: HOME_DIR })).rejects.toThrow(TypeError);

    await expect(loadSkills({ cwd: '0', homeDir: HOME_DIR })).resolves.toEqual({ skills: [], errors: [] });
  });

  it('is stable under rapid consecutive and concurrent calls', async () => {
    const { loadSkills } = await importFreshLoader();

    const repoRoot = `${REPO_ROOT}/.paper-burner/skills`;
    addDir(`${repoRoot}/a`);
    addFile(
      `${repoRoot}/a/SKILL.md`,
      makeSkillFile(makeBasicFrontmatter('a', 'd'), 'b'),
    );

    const sequential = [];
    for (let i = 0; i < 5; i++) {
      sequential.push(await loadSkills({ cwd: REPO_ROOT, homeDir: HOME_DIR }));
    }
    for (let i = 1; i < sequential.length; i++) {
      expect(simplifyOutcome(sequential[i])).toEqual(simplifyOutcome(sequential[0]));
    }

    const [p1, p2, p3] = await Promise.all([
      loadSkills({ cwd: REPO_ROOT, homeDir: HOME_DIR }),
      loadSkills({ cwd: REPO_ROOT, homeDir: HOME_DIR }),
      loadSkills({ cwd: REPO_ROOT, homeDir: HOME_DIR }),
    ]);
    expect(simplifyOutcome(p1)).toEqual(simplifyOutcome(p2));
    expect(simplifyOutcome(p2)).toEqual(simplifyOutcome(p3));
  });
});

describe('loadSkillsFromNexus', () => {
  it('returns empty outcome when provider is falsy or unavailable', async () => {
    const { loadSkillsFromNexus } = await importFreshLoader();
    await expect(loadSkillsFromNexus()).resolves.toEqual({ skills: [], errors: [] });
    await expect(loadSkillsFromNexus(null)).resolves.toEqual({ skills: [], errors: [] });
    await expect(loadSkillsFromNexus(0)).resolves.toEqual({ skills: [], errors: [] });

    const provider = {
      isAvailable: vi.fn(async () => false),
      listSkills: vi.fn(),
      getSkillContent: vi.fn(),
    };

    const out = await loadSkillsFromNexus(provider);
    expect(out).toEqual({ skills: [], errors: [] });
    expect(provider.listSkills).not.toHaveBeenCalled();
    expect(provider.getSkillContent).not.toHaveBeenCalled();
  });

  it('loads remote skills and maps metadata fields', async () => {
    const { loadSkillsFromNexus } = await importFreshLoader();

    const provider = {
      isAvailable: vi.fn(async () => true),
      listSkills: vi.fn(async () => [
        { name: 'remote-a', description: 'A', allowedTools: ['x', 'y'], priority: 123 },
        { name: 'remote-b', description: 'B', allowedTools: [], priority: 0 },
      ]),
      getSkillContent: vi.fn(async (name) => {
        if (name === 'remote-a') return { body: 'body-a', supportFiles: { 'a.txt': 'A' } };
        if (name === 'remote-b') return { body: 'body-b', supportFiles: Object.create(null) };
        throw new Error('unknown skill');
      }),
    };

    const out = await loadSkillsFromNexus(provider);
    expect(out.errors).toEqual([]);
    expect(out.skills.map((s) => s.metadata.name)).toEqual(['remote-a', 'remote-b']);

    const a = out.skills.find((s) => s.metadata.name === 'remote-a');
    expect(a?.metadata).toEqual(
      expect.objectContaining({
        name: 'remote-a',
        description: 'A',
        path: 'nexus://remote-a',
        scope: SkillScope.REMOTE,
        allowedTools: 'x,y',
        priority: 123,
      }),
    );
    expect(a?.supportFiles).toEqual({ 'a.txt': 'A' });
    expect(a?.body).toBe('body-a');

    const b = out.skills.find((s) => s.metadata.name === 'remote-b');
    expect(b?.metadata?.allowedTools).toBeNull();
    expect(b?.metadata?.priority).toBe(200);
  });

  it('captures per-skill errors and continues loading others', async () => {
    const { loadSkillsFromNexus } = await importFreshLoader();

    const provider = {
      isAvailable: vi.fn(async () => true),
      listSkills: vi.fn(async () => [
        { name: 'ok', description: 'OK', allowedTools: ['x'], priority: 10 },
        { name: 'bad', description: 'BAD', allowedTools: ['y'], priority: 10 },
      ]),
      getSkillContent: vi.fn(async (name) => {
        if (name === 'ok') return { body: 'ok', supportFiles: { 'k': 'v' } };
        throw new Error('boom');
      }),
    };

    const out = await loadSkillsFromNexus(provider);
    expect(out.skills.map((s) => s.metadata.name)).toEqual(['ok']);
    expect(out.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'nexus://bad',
          message: expect.stringContaining('boom'),
        }),
      ]),
    );
  });

  it('captures connection failures as an outcome error (does not throw)', async () => {
    const { loadSkillsFromNexus } = await importFreshLoader();

    const provider = {
      isAvailable: vi.fn(async () => {
        throw new Error('offline');
      }),
      listSkills: vi.fn(),
      getSkillContent: vi.fn(),
    };

    const out = await loadSkillsFromNexus(provider);
    expect(out.skills).toEqual([]);
    expect(out.errors).toEqual([
      expect.objectContaining({
        path: 'nexus://',
        message: expect.stringContaining('Failed to connect to Nexus:'),
      }),
    ]);
  });

  it('is stable under concurrent calls', async () => {
    const { loadSkillsFromNexus } = await importFreshLoader();

    const provider = {
      isAvailable: vi.fn(async () => true),
      listSkills: vi.fn(async () => [{ name: 'x', description: 'X', allowedTools: ['t'], priority: 1 }]),
      getSkillContent: vi.fn(async () => ({ body: 'b', supportFiles: { 'f': 'c' } })),
    };

    const [a, b] = await Promise.all([loadSkillsFromNexus(provider), loadSkillsFromNexus(provider)]);
    expect(simplifyOutcome(a)).toEqual(simplifyOutcome(b));
  });
});

describe('loadAllSkills', () => {
  it('merges local and remote skills (local takes precedence) and appends remote errors', async () => {
    const { loadAllSkills } = await importFreshLoader();

    const repoRoot = `${REPO_ROOT}/.paper-burner/skills`;
    addDir(`${repoRoot}/dup`);
    addFile(
      `${repoRoot}/dup/SKILL.md`,
      makeSkillFile(makeBasicFrontmatter('dup', 'local dup'), 'local'),
    );

    addDir(`${repoRoot}/local-only`);
    addFile(
      `${repoRoot}/local-only/SKILL.md`,
      makeSkillFile(makeBasicFrontmatter('local-only', 'local only'), 'local-only'),
    );

    const provider = {
      isAvailable: vi.fn(async () => true),
      listSkills: vi.fn(async () => [
        { name: 'dup', description: 'remote dup', allowedTools: ['t'], priority: 10 },
        { name: 'remote-only', description: 'remote only', allowedTools: ['t'], priority: 10 },
        { name: 'remote-bad', description: 'remote bad', allowedTools: ['t'], priority: 10 },
      ]),
      getSkillContent: vi.fn(async (name) => {
        if (name === 'remote-only') return { body: 'remote-only', supportFiles: { 'r': '1' } };
        if (name === 'dup') return { body: 'dup-remote', supportFiles: {} };
        throw new Error('bad remote');
      }),
    };

    const out = await loadAllSkills({ cwd: REPO_ROOT, homeDir: HOME_DIR, nexusProvider: provider });
    const names = out.skills.map((s) => s.metadata.name);
    expect(new Set(names)).toEqual(new Set(['dup', 'local-only', 'remote-only']));

    const dup = out.skills.find((s) => s.metadata.name === 'dup');
    expect(dup?.metadata?.description).toBe('local dup');
    expect(dup?.metadata?.scope).toBe(SkillScope.REPO);

    const remote = out.skills.find((s) => s.metadata.name === 'remote-only');
    expect(remote?.metadata?.scope).toBe(SkillScope.REMOTE);

    expect(out.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'nexus://remote-bad',
          message: expect.stringContaining('bad remote'),
        }),
      ]),
    );
  });

  it('behaves like loadSkills when provider is missing', async () => {
    const { loadAllSkills } = await importFreshLoader();

    const repoRoot = `${REPO_ROOT}/.paper-burner/skills`;
    addDir(`${repoRoot}/a`);
    addFile(
      `${repoRoot}/a/SKILL.md`,
      makeSkillFile(makeBasicFrontmatter('a', 'd'), 'b'),
    );

    const out = await loadAllSkills({ cwd: REPO_ROOT, homeDir: HOME_DIR });
    expect(out.skills.map((s) => s.metadata.name)).toEqual(['a']);
    expect(out.errors).toEqual([]);
  });

  it('rejects for null options (type boundary)', async () => {
    const { loadAllSkills } = await importFreshLoader();
    await expect(loadAllSkills(null)).rejects.toThrow(TypeError);
  });
});

describe('loadSkillFromPath', () => {
  it('requires a non-empty string filePath (null/undefined/empty/whitespace/type boundaries)', async () => {
    const { loadSkillFromPath } = await importFreshLoader();

    await expect(loadSkillFromPath()).rejects.toThrow('filePath is required');
    await expect(loadSkillFromPath(null)).rejects.toThrow('filePath is required');
    await expect(loadSkillFromPath(undefined)).rejects.toThrow('filePath is required');
    await expect(loadSkillFromPath('')).rejects.toThrow('filePath is required');
    await expect(loadSkillFromPath('   ')).rejects.toThrow('filePath is required');
    await expect(loadSkillFromPath(0)).rejects.toThrow('filePath is required');
    await expect(loadSkillFromPath(-1)).rejects.toThrow('filePath is required');
    await expect(loadSkillFromPath(Number.MAX_SAFE_INTEGER)).rejects.toThrow('filePath is required');
    await expect(loadSkillFromPath([])).rejects.toThrow('filePath is required');
    await expect(loadSkillFromPath({})).rejects.toThrow('filePath is required');
  });

  it('rejects when filePath is outside `.paper-burner/skills`', async () => {
    const { loadSkillFromPath } = await importFreshLoader();

    const outside = `${REPO_ROOT}/not-paper-burner/skills/x/SKILL.md`;
    addDir(`${REPO_ROOT}/not-paper-burner/skills/x`);
    addFile(outside, makeSkillFile(makeBasicFrontmatter('x', 'd'), 'b'));

    await expect(loadSkillFromPath(outside)).rejects.toThrow('path must be within .paper-burner/skills');
  });

  it('loads and parses metadata fields (multiline, tags, keywords, traits, priority) and body', async () => {
    const { loadSkillFromPath } = await importFreshLoader();

    const filePath = `${REPO_ROOT}/.paper-burner/skills/alpha/SKILL.md`;
    addDir(`${REPO_ROOT}/.paper-burner/skills/alpha`);
    addFile(
      filePath,
      makeSkillFile(
        [
          'name:   alpha   skill  ',
          'description: |',
          '  first line',
          '  second line',
          'short-description: "Short  desc"',
          'keywords: one, two , , three',
          'keywords-all: all1, all2',
          'allowed-tools: tool-a, tool-b',
          'tags: ok:1,broken,__proto__:x,constructor:y',
          'traits: brave, kind',
          'priority: 042',
        ].join('\n'),
        '  Body content  ',
      ),
    );

    expect({}.polluted).toBeUndefined();
    const skill = await loadSkillFromPath(filePath, SkillScope.REPO);
    expect(skill.metadata.scope).toBe(SkillScope.REPO);
    expect(skill.metadata.name).toBe('alpha skill');
    expect(skill.metadata.description).toBe('first line second line');
    expect(skill.metadata.shortDescription).toBe('Short  desc');
    expect(skill.metadata.keywords).toEqual(['one', 'two', 'three']);
    expect(skill.metadata.keywordsAll).toEqual(['all1', 'all2']);
    expect(skill.metadata.allowedTools).toBe('tool-a, tool-b');
    expect(skill.metadata.priority).toBe(42);

    expect(skill.body).toBe('Body content');

    expect(skill.metadata.tags).not.toBeNull();
    expect(Object.getPrototypeOf(skill.metadata.tags)).toBeNull();
    expect(Object.assign({}, skill.metadata.tags)).toEqual({ ok: '1', broken: '' });
    expect(Object.prototype.hasOwnProperty.call(skill.metadata.tags, '__proto__')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(skill.metadata.tags, 'constructor')).toBe(false);
    expect({}.polluted).toBeUndefined();

    expect(skill.metadata.traits).toEqual(['brave', 'kind']);
  });

  it('enforces name/description max lengths (boundary values)', async () => {
    const { loadSkillFromPath } = await importFreshLoader();

    const baseDir = `${REPO_ROOT}/.paper-burner/skills/len`;
    addDir(baseDir);

    const okNamePath = `${baseDir}/ok-name/SKILL.md`;
    addDir(`${baseDir}/ok-name`);
    addFile(okNamePath, makeSkillFile(makeBasicFrontmatter('n'.repeat(64), 'd'), 'b'));
    await expect(loadSkillFromPath(okNamePath)).resolves.toBeTruthy();

    const tooLongNamePath = `${baseDir}/too-long-name/SKILL.md`;
    addDir(`${baseDir}/too-long-name`);
    addFile(tooLongNamePath, makeSkillFile(makeBasicFrontmatter('n'.repeat(65), 'd'), 'b'));
    await expect(loadSkillFromPath(tooLongNamePath)).rejects.toThrow('name exceeds maximum length');

    const okDescPath = `${baseDir}/ok-desc/SKILL.md`;
    addDir(`${baseDir}/ok-desc`);
    addFile(okDescPath, makeSkillFile(makeBasicFrontmatter('ok-desc', 'd'.repeat(1024)), 'b'));
    await expect(loadSkillFromPath(okDescPath)).resolves.toBeTruthy();

    const tooLongDescPath = `${baseDir}/too-long-desc/SKILL.md`;
    addDir(`${baseDir}/too-long-desc`);
    addFile(tooLongDescPath, makeSkillFile(makeBasicFrontmatter('too-long-desc', 'd'.repeat(1025)), 'b'));
    await expect(loadSkillFromPath(tooLongDescPath)).rejects.toThrow('description exceeds maximum length');
  });

  it('throws for missing YAML frontmatter / required fields (error handling)', async () => {
    const { loadSkillFromPath } = await importFreshLoader();

    const baseDir = `${REPO_ROOT}/.paper-burner/skills/errors`;
    addDir(baseDir);

    const missingFm = `${baseDir}/missing-fm/SKILL.md`;
    addDir(`${baseDir}/missing-fm`);
    addFile(missingFm, 'name: a\ndescription: b\n');
    await expect(loadSkillFromPath(missingFm)).rejects.toThrow('missing YAML frontmatter');

    const missingDesc = `${baseDir}/missing-desc/SKILL.md`;
    addDir(`${baseDir}/missing-desc`);
    addFile(missingDesc, makeSkillFile('name: a', 'b'));
    await expect(loadSkillFromPath(missingDesc)).rejects.toThrow('missing field `description`');
  });

  it('caches identical file contents across sequential calls (fast repeated calls)', async () => {
    const { loadSkillFromPath } = await importFreshLoader();

    const filePath = `${REPO_ROOT}/.paper-burner/skills/cache/SKILL.md`;
    addDir(`${REPO_ROOT}/.paper-burner/skills/cache`);
    addFile(filePath, makeSkillFile(makeBasicFrontmatter('cache', 'd'), 'b'));

    const first = await loadSkillFromPath(filePath);
    for (let i = 0; i < 10; i++) {
      // Same object reference comes from the fingerprint cache
      // (while still reading the file each time).
      const next = await loadSkillFromPath(filePath);
      expect(next).toBe(first);
    }
  });

  it('allows priority=0 and preserves NaN when parsing invalid priority strings', async () => {
    const { loadSkillFromPath } = await importFreshLoader();

    const baseDir = `${REPO_ROOT}/.paper-burner/skills/priority`;
    addDir(baseDir);

    const zeroPath = `${baseDir}/zero/SKILL.md`;
    addDir(`${baseDir}/zero`);
    addFile(zeroPath, makeSkillFile(`${makeBasicFrontmatter('zero', 'd')}\npriority: 0`, 'b'));
    const zero = await loadSkillFromPath(zeroPath);
    expect(zero.metadata.priority).toBe(0);

    const nanPath = `${baseDir}/nan/SKILL.md`;
    addDir(`${baseDir}/nan`);
    addFile(nanPath, makeSkillFile(`${makeBasicFrontmatter('nan', 'd')}\npriority: not-a-number`, 'b'));
    const nan = await loadSkillFromPath(nanPath);
    expect(Number.isNaN(nan.metadata.priority)).toBe(true);
  });
});

describe('default export', () => {
  it('exposes the same primary loader functions', async () => {
    const mod = await importFreshLoader();
    expect(mod.default).toEqual(
      expect.objectContaining({
        loadSkills: expect.any(Function),
        loadSkillFromPath: expect.any(Function),
        loadSkillsFromNexus: expect.any(Function),
        loadAllSkills: expect.any(Function),
      }),
    );
  });
});