import { beforeEach, describe, expect, it, vi } from 'vitest';

async function loadContentListToChunks() {
  await import('../../js/processing/content-list-to-chunks.js');
  return globalThis.ContentListToChunks;
}

describe('js/processing/content-list-to-chunks.js', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();

    globalThis.window ??= {};

    delete globalThis.estimateTokenCount;
    delete globalThis.splitMarkdownIntoChunks;
    delete globalThis.generateChunksFromContentList;
    delete globalThis.generateChunksFromFullText;
    delete globalThis.ContentListToChunks;

    if (globalThis.window) {
      delete globalThis.window.generateChunksFromContentList;
      delete globalThis.window.generateChunksFromFullText;
      delete globalThis.window.ContentListToChunks;
    }

    vi.spyOn(console, 'debug').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('exports a ContentListToChunks facade with helper functions', async () => {
    const api = await loadContentListToChunks();

    expect(api).toMatchObject({ version: '1.0.0' });
    expect(typeof api.generateChunksFromContentList).toBe('function');
    expect(typeof api.generateChunksFromFullText).toBe('function');
    expect(typeof api.groupByPage).toBe('function');
    expect(typeof api.groupBySection).toBe('function');
    expect(typeof api.extractTextFromSection).toBe('function');
    expect(typeof api.estimateTokens).toBe('function');
  });

  describe('groupByPage', () => {
    it('returns empty groups for empty array', async () => {
      const api = await loadContentListToChunks();
      expect(api.groupByPage([])).toEqual({});
    });

    it('groups single-page content', async () => {
      const api = await loadContentListToChunks();
      const item = { page_idx: 0, type: 'text', text: 'hello' };

      expect(api.groupByPage([item])).toEqual({ 0: [item] });
    });

    it('groups multi-page content', async () => {
      const api = await loadContentListToChunks();
      const items = [
        { page_idx: 0, type: 'text', text: 'p0-a' },
        { page_idx: 1, type: 'text', text: 'p1-a' },
        { page_idx: 0, type: 'text', text: 'p0-b' },
      ];

      expect(api.groupByPage(items)).toEqual({
        0: [items[0], items[2]],
        1: [items[1]],
      });
    });
  });

  describe('groupBySection', () => {
    it('merges adjacent items with the same type', async () => {
      const api = await loadContentListToChunks();
      const items = [
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' },
      ];

      expect(api.groupBySection(items)).toEqual([items]);
    });

    it('splits sections when type changes', async () => {
      const api = await loadContentListToChunks();
      const items = [
        { type: 'text', text: 'a' },
        { type: 'title', text: 't1', level: 2 },
        { type: 'text', text: 'b' },
        { type: 'image', caption: 'img' },
        { type: 'image', caption: 'img2' },
        { type: 'table', markdown: '|a|' },
      ];

      const sections = api.groupBySection(items);

      expect(sections).toHaveLength(5);
      expect(sections[0]).toEqual([items[0]]);
      expect(sections[1]).toEqual([items[1]]);
      expect(sections[2]).toEqual([items[2]]);
      expect(sections[3]).toEqual([items[3], items[4]]);
      expect(sections[4]).toEqual([items[5]]);
    });
  });

  describe('extractTextFromSection', () => {
    it('extracts text items', async () => {
      const api = await loadContentListToChunks();
      const section = [
        { type: 'text', text: 'hello' },
        { content: 'world' },
      ];

      expect(api.extractTextFromSection(section)).toBe('hello\n\nworld');
    });

    it('extracts titles with level', async () => {
      const api = await loadContentListToChunks();
      const section = [{ type: 'title', level: 3, text: 'Heading' }];
      expect(api.extractTextFromSection(section)).toBe('### Heading');
    });

    it('extracts tables', async () => {
      const api = await loadContentListToChunks();
      const section = [{ type: 'table', markdown: '|a|b|\\n|1|2|' }];
      expect(api.extractTextFromSection(section)).toBe('|a|b|\\n|1|2|');
    });

    it('extracts images', async () => {
      const api = await loadContentListToChunks();
      const section = [{ type: 'image', caption: 'Figure 1: demo' }];
      expect(api.extractTextFromSection(section)).toBe('Figure 1: demo');
    });
  });

  describe('estimateTokens', () => {
    it('estimates pure English', async () => {
      const api = await loadContentListToChunks();
      expect(api.estimateTokens('Hello world')).toBe(3);
    });

    it('estimates pure Chinese', async () => {
      const api = await loadContentListToChunks();
      expect(api.estimateTokens('你好世界')).toBe(2);
    });

    it('estimates mixed text', async () => {
      const api = await loadContentListToChunks();
      expect(api.estimateTokens('Hello 世界')).toBe(3);
    });
  });

  describe('generateChunksFromContentList', () => {
    it('returns empty chunks for empty input', async () => {
      const api = await loadContentListToChunks();
      const result = api.generateChunksFromContentList(null);

      expect(result).toEqual({ ocrChunks: [], translatedChunks: [] });
      expect(console.warn).toHaveBeenCalled();
    });

    it('generates chunks with token-based splitting', async () => {
      const api = await loadContentListToChunks();

      const contentList = [
        { page_idx: 0, type: 'text', text: 'abcdefgh' },
        { page_idx: 0, type: 'title', level: 1, text: 'Title1234' },
        { page_idx: 0, type: 'text', text: 'ijkl' },
      ];

      const translated = [
        { page_idx: 0, type: 'text', text: 'ABCDEFGH' },
        { page_idx: 0, type: 'title', level: 1, text: '标题' },
        { page_idx: 0, type: 'text', text: 'IJKL' },
      ];

      const result = api.generateChunksFromContentList(contentList, translated, 3);

      expect(result.ocrChunks).toEqual(['abcdefgh', '# Title1234', 'ijkl']);
      expect(result.translatedChunks).toEqual(['ABCDEFGH', '# 标题', 'IJKL']);
    });
  });
});
