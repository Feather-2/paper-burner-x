import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockedShared = vi.hoisted(() => {
  const toNonEmptyString = vi.fn();
  const isPlainObject = vi.fn();
  return { toNonEmptyString, isPlainObject };
});

const mockedBase = vi.hoisted(() => {
  const buildParsedDocumentMock = vi.fn();

  class BaseAdapter {
    constructor(options = {}) {
      this.adapterName = options?.adapterName || 'base';
      this.defaultChunkOptions = options?.defaultChunkOptions || {};
      this.buildParsedDocument = buildParsedDocumentMock;
    }
  }

  return { BaseAdapter, buildParsedDocumentMock };
});

vi.mock('../../../../../js/agents/shared/index.js', () => ({
  isPlainObject: mockedShared.isPlainObject,
  toNonEmptyString: mockedShared.toNonEmptyString,
}));

vi.mock('../../../../../js/agents/ingest/adapters/base.js', () => ({
  BaseAdapter: mockedBase.BaseAdapter,
}));

import { HistoryAdapter } from '../../../../../js/agents/ingest/adapters/history.js';

beforeEach(() => {
  mockedShared.toNonEmptyString.mockReset();
  mockedShared.isPlainObject.mockReset();
  mockedBase.buildParsedDocumentMock.mockReset();

  mockedShared.toNonEmptyString.mockImplementation((value) => {
    if (value === undefined || value === null) return undefined;
    const s = String(value).trim();
    return s.length ? s : undefined;
  });

  mockedShared.isPlainObject.mockImplementation((value) => {
    if (value === null || typeof value !== 'object') return false;
    if (Array.isArray(value)) return false;
    const proto = Object.getPrototypeOf(value);
    return proto === Object.prototype || proto === null;
  });

  mockedBase.buildParsedDocumentMock.mockImplementation((params = {}) => {
    const origin = params.origin || {};
    const docId = params.docId || (origin.historyId ? `doc_${origin.historyId}` : 'doc_unknown');
    return {
      docId,
      sourceType: params.sourceType || 'markdown',
      origin,
      markdown: String(params.markdown || ''),
      assets: Array.isArray(params.assets) ? params.assets : [],
      metadata: params.metadata || {},
      parseInfo: params.parseInfo || {},
    };
  });
});

describe('HistoryAdapter', () => {
  it.each([
    { label: 'null', value: null },
    { label: 'undefined', value: undefined },
    { label: 'empty string', value: '' },
    { label: 'whitespace string', value: '   ' },
  ])('throws TypeError for invalid historyId: $label', async ({ value }) => {
    const storageAdapter = { getResultFromDB: vi.fn(async () => ({ translation: 'ok' })) };
    const adapter = new HistoryAdapter(storageAdapter);

    let error;
    try {
      await adapter.parse(value);
    } catch (err) {
      error = err;
    }

    expect(error).toBeInstanceOf(TypeError);
    expect(error.message).toContain('historyId must be a string');
    expect(storageAdapter.getResultFromDB).not.toHaveBeenCalled();
  });

  it.each([
    { label: 'null adapter', storageAdapter: null },
    { label: 'empty object', storageAdapter: {} },
    { label: 'non-function getter', storageAdapter: { getResultFromDB: 123 } },
  ])('throws when storage adapter missing: $label', async ({ storageAdapter }) => {
    const adapter = new HistoryAdapter(storageAdapter);
    await expect(adapter.parse('hid')).rejects.toThrow('storageAdapter with getResultFromDB() is required');
  });

  it.each([null, undefined])('throws when history record not found: %p', async (record) => {
    const storageAdapter = { getResultFromDB: vi.fn(async () => record) };
    const adapter = new HistoryAdapter(storageAdapter);

    await expect(adapter.parse('hid')).rejects.toThrow('history record not found: hid');
    expect(mockedBase.buildParsedDocumentMock).not.toHaveBeenCalled();
  });

  it('throws when record missing markdown/ocr (empty object)', async () => {
    const storageAdapter = { getResultFromDB: vi.fn(async () => ({})) };
    const adapter = new HistoryAdapter(storageAdapter);

    await expect(adapter.parse('hid')).rejects.toThrow('missing markdown/ocr');
    expect(mockedBase.buildParsedDocumentMock).not.toHaveBeenCalled();
  });

  it('prefers getResultFromDB when multiple getters exist', async () => {
    const getResultFromDB = vi.fn(async () => ({ markdown: 'db', images: [] }));
    const getResult = vi.fn(async () => ({ markdown: 'other', images: [] }));
    const adapter = new HistoryAdapter({ getResultFromDB, getResult });

    const parsed = await adapter.parse('hid');

    expect(parsed.markdown).toBe('db');
    expect(getResultFromDB).toHaveBeenCalledWith('hid');
    expect(getResult).not.toHaveBeenCalled();
  });

  it('parses translation and builds assets with correct mime types', async () => {
    const record = {
      translation: 'Translated text',
      ocr: 'OCR text',
      markdown: 'Markdown text',
      name: 'Report Name',
      title: 'Fallback Title',
      fileType: 'pdf',
      images: [
        { id: 'chart.svg', data: 'data:image/svg+xml,<svg></svg>' },
        null,
        { name: 'photo.jpg', data: 'binarydata' },
        { data: 'data:image/webp;base64,AAA' },
        'data:image/gif;base64,AAA',
        { id: '', name: '', data: '' },
      ],
    };
    const storageAdapter = { getResultFromDB: vi.fn(async () => record) };
    const adapter = new HistoryAdapter(storageAdapter);

    const parsed = await adapter.parse('hid123');

    expect(storageAdapter.getResultFromDB).toHaveBeenCalledWith('hid123');
    expect(parsed.docId).toBe('doc_hid123');
    expect(parsed.markdown).toBe('Translated text');
    expect(parsed.sourceType).toBe('pdf');
    expect(parsed.origin).toEqual({ historyId: 'hid123', filename: 'Report Name' });
    expect(parsed.metadata).toEqual({ title: 'Report Name', historyId: 'hid123', fileType: 'pdf' });
    expect(parsed.parseInfo.adapter).toBe('history');
    expect(parsed.parseInfo.durationMs).toBeGreaterThanOrEqual(0);

    const buildArgs = mockedBase.buildParsedDocumentMock.mock.calls[0][0];
    expect(buildArgs.sourceType).toBe('pdf');
    expect(buildArgs.assets).toHaveLength(4);

    expect(parsed.assets.map((asset) => asset.assetId)).toEqual([
      'asset_hid123_1',
      'asset_hid123_3',
      'asset_hid123_4',
      'asset_hid123_5',
    ]);
    expect(parsed.assets.map((asset) => asset.mimeType)).toEqual([
      'image/svg+xml',
      'image/jpeg',
      'image/webp',
      'image/gif',
    ]);
    expect(parsed.assets.map((asset) => asset.data)).toEqual([
      'data:image/svg+xml,<svg></svg>',
      'binarydata',
      'data:image/webp;base64,AAA',
      'data:image/gif;base64,AAA',
    ]);
    expect(parsed.assets.every((asset) => asset.docId === parsed.docId)).toBe(true);
    parsed.assets.forEach((asset) => {
      expect(asset).toMatchObject({
        type: 'image',
        source: 'extracted',
        reusable: true,
      });
    });
  });

  it('falls back to ocr when translation missing and uses sourceType', async () => {
    const record = {
      translation: '   ',
      ocr: 'OCR wins',
      markdown: 'Markdown fallback',
      title: 'Only Title',
      fileType: '   ',
      sourceType: 'text',
      images: [],
    };
    const storageAdapter = { getResultFromDB: vi.fn(async () => record) };
    const adapter = new HistoryAdapter(storageAdapter);

    const parsed = await adapter.parse('hid-ocr');

    expect(parsed.markdown).toBe('OCR wins');
    expect(parsed.sourceType).toBe('text');
    expect(parsed.origin.filename).toBe('Only Title');
    expect(parsed.metadata.fileType).toBe('text');
  });

  it('falls back to markdown when translation/ocr missing', async () => {
    const record = {
      translation: null,
      ocr: ' ',
      markdown: 'Markdown wins',
      images: [],
    };
    const storageAdapter = { getResultFromDB: vi.fn(async () => record) };
    const adapter = new HistoryAdapter(storageAdapter);

    const parsed = await adapter.parse('hid-md');

    expect(parsed.markdown).toBe('Markdown wins');
    expect(parsed.origin.filename).toBe('hid-md');
  });

  it.each([0, -1, Number.MAX_SAFE_INTEGER, '123'])('accepts boundary historyId values: %p', async (value) => {
    const record = { markdown: 'ok', images: [] };
    const storageAdapter = { getResultFromDB: vi.fn(async () => record) };
    const adapter = new HistoryAdapter(storageAdapter);

    const parsed = await adapter.parse(value);
    const expected = String(value).trim();

    expect(storageAdapter.getResultFromDB).toHaveBeenCalledWith(expected);
    expect(parsed.origin.historyId).toBe(expected);
    expect(parsed.metadata.historyId).toBe(expected);
    expect(parsed.origin.filename).toBe(expected);
    expect(parsed.metadata.title).toBe(expected);
  });

  it.each([
    { label: 'empty array', images: [] },
    { label: 'object as array', images: { 0: { data: 'data:image/png;base64,AAA' } } },
  ])('treats non-array images as empty: $label', async ({ images }) => {
    const record = { markdown: 'md', images };
    const storageAdapter = { getResultFromDB: vi.fn(async () => record) };
    const adapter = new HistoryAdapter(storageAdapter);

    const parsed = await adapter.parse('hid');

    expect(parsed.assets).toEqual([]);
    const buildArgs = mockedBase.buildParsedDocumentMock.mock.calls[0][0];
    expect(buildArgs.assets).toEqual([]);
  });

  it('handles concurrent parse calls', async () => {
    const getter = vi.fn(async (hid) => ({ markdown: `md-${hid}`, images: [] }));
    const adapter = new HistoryAdapter({ getResultFromDB: getter });

    const [first, second] = await Promise.all([adapter.parse('a'), adapter.parse('b')]);

    expect(first.markdown).toBe('md-a');
    expect(second.markdown).toBe('md-b');
    expect(first.origin.historyId).toBe('a');
    expect(second.origin.historyId).toBe('b');
    expect(getter).toHaveBeenCalledTimes(2);
    expect(getter.mock.calls.map((call) => call[0])).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('handles large markdown, long title, and deep nested image data', async () => {
    const largeMarkdown = 'x'.repeat(100000);
    const longTitle = 'T'.repeat(10000);
    const record = {
      translation: largeMarkdown,
      name: longTitle,
      images: [
        {
          id: 'deep.png',
          data: `data:image/png;base64,${'A'.repeat(1000)}`,
          meta: { a: { b: { c: { d: { e: { f: 1 } } } } } },
        },
      ],
    };
    const storageAdapter = { getResultFromDB: vi.fn(async () => record) };
    const adapter = new HistoryAdapter(storageAdapter);

    const parsed = await adapter.parse('big');

    expect(parsed.markdown.length).toBe(largeMarkdown.length);
    expect(parsed.metadata.title.length).toBe(longTitle.length);
    expect(parsed.assets).toHaveLength(1);
    expect(parsed.assets[0].mimeType).toBe('image/png');
    expect(parsed.assets[0].docId).toBe(parsed.docId);
  });
});
