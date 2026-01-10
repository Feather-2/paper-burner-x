/**
 * @file tests/chatbot/segmentation-strategy.test.js
 * @description 分段策略模块单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  parseTableOfContents,
  splitIntoNaturalParagraphs,
  segmentDocumentByToC,
  buildPreprocessedJson,
  retrieveRelevantContent,
  processSegment,
  processSegmentWithRetry,
  runSegmentationAndProcessing,
} from '../../js/chatbot/strategy/segmentation-strategy.js';

const previousWindow = globalThis.window;

describe('SegmentationStrategy', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();

    if (typeof previousWindow === 'undefined') {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  });

  describe('parseTableOfContents', () => {
    it('should return a placeholder structured ToC', () => {
      const toc = parseTableOfContents('some toc input');
      expect(toc).toEqual({ title: '文档根节点', level: 0, children: [] });
    });
  });

  describe('splitIntoNaturalParagraphs', () => {
    it('should return [] for empty/null/undefined input', () => {
      expect(splitIntoNaturalParagraphs('')).toEqual([]);
      expect(splitIntoNaturalParagraphs(null)).toEqual([]);
      expect(splitIntoNaturalParagraphs(undefined)).toEqual([]);
    });

    it('should split by blank lines and trim paragraphs', () => {
      const text = ['  para1  ', '', '  ', 'para2', '', '', 'para3   '].join('\n');
      expect(splitIntoNaturalParagraphs(text)).toEqual(['para1', 'para2', 'para3']);
    });
  });

  describe('segmentDocumentByToC', () => {
    it('should fallback to a single "全文" section when no headings exist', () => {
      const doc = 'Para 1.\n\nPara 2.\n';
      const sections = segmentDocumentByToC(doc, {});

      expect(sections).toHaveLength(1);
      expect(sections[0].tocTitle).toBe('全文');
      expect(sections[0].tocLevel).toBe(1);
      expect(sections[0].rawSectionText).toBe(doc);
      expect(sections[0].naturalSegments).toEqual(['Para 1.', 'Para 2.']);
    });

    it('should segment by markdown headings and merge paragraphs under the threshold', () => {
      const doc = [
        '# Intro',
        'First para.',
        '',
        'Second para.',
        '',
        '## Details',
        'Detail paragraph.',
        '',
        '# Conclusion',
        'End.',
      ].join('\n');

      const sections = segmentDocumentByToC(doc, {});
      expect(sections).toHaveLength(3);

      expect(sections[0]).toMatchObject({
        tocTitle: 'Intro',
        tocLevel: 1,
        rawSectionText: 'First para.\n\nSecond para.',
        naturalSegments: ['First para.\n\nSecond para.'],
      });

      expect(sections[1]).toMatchObject({
        tocTitle: 'Details',
        tocLevel: 2,
        rawSectionText: 'Detail paragraph.',
        naturalSegments: ['Detail paragraph.'],
      });

      expect(sections[2]).toMatchObject({
        tocTitle: 'Conclusion',
        tocLevel: 1,
        rawSectionText: 'End.',
        naturalSegments: ['End.'],
      });
    });

    it('should split merged segments when the combined size exceeds the threshold', () => {
      const longA = 'a'.repeat(6000);
      const longB = 'b'.repeat(6000);
      const doc = `# Long\n${longA}\n\n${longB}\n`;

      const sections = segmentDocumentByToC(doc, {});
      expect(sections).toHaveLength(1);
      expect(sections[0].tocTitle).toBe('Long');
      expect(sections[0].naturalSegments).toEqual([longA, longB]);
    });
  });

  describe('buildPreprocessedJson', () => {
    it('should combine toc sections with processed segment data and fallback missing items', () => {
      const tocSections = [
        {
          tocTitle: 'Intro',
          tocLevel: 1,
          rawSectionText: 'raw',
          naturalSegments: ['seg1', 'seg2'],
        },
        {
          tocTitle: 'Next',
          tocLevel: 2,
          rawSectionText: 'raw2',
          naturalSegments: ['only'],
        },
      ];

      const processed = [[{ summary: 'S1', details: ['d1'], length: 10 }]];
      const json = buildPreprocessedJson(tocSections, processed);

      expect(json).toHaveLength(2);
      expect(json[0].tocTitle).toBe('Intro');
      expect(json[0].segments).toEqual([
        { originalText: 'seg1', summary: 'S1', details: ['d1'], length: 10 },
        { originalText: 'seg2', summary: '片段处理失败。', details: [], length: 4 },
      ]);
      expect(json[0].totalSectionLength).toBe(10 + 'seg2'.length);

      expect(json[1].tocTitle).toBe('Next');
      expect(json[1].segments).toEqual([
        { originalText: 'only', summary: '片段处理失败。', details: [], length: 4 },
      ]);
      expect(json[1].totalSectionLength).toBe('only'.length);
    });
  });

  describe('retrieveRelevantContent', () => {
    it('should rank results using originalText + summary + tocTitle weights', async () => {
      const preprocessedJson = [
        {
          tocTitle: 'Alpha Section',
          tocLevel: 1,
          segments: [
            { originalText: 'lorem ipsum', summary: 'beta', details: [], length: 11 },
            { originalText: 'contains alpha', summary: 'nope', details: [], length: 14 },
          ],
          totalSectionLength: 25,
        },
        {
          tocTitle: 'Other',
          tocLevel: 1,
          segments: [{ originalText: 'gamma', summary: 'alpha alpha', details: [], length: 5 }],
          totalSectionLength: 5,
        },
      ];

      const results = await retrieveRelevantContent('alpha', preprocessedJson, 50000, 2);
      expect(results).toEqual(['gamma', 'contains alpha']);
    });

    it('should fallback to the first segment when no match is found', async () => {
      const preprocessedJson = [
        {
          tocTitle: 'Intro',
          tocLevel: 1,
          segments: [
            { originalText: 'first segment', summary: '', details: [], length: 13 },
            { originalText: 'second', summary: '', details: [], length: 6 },
          ],
          totalSectionLength: 19,
        },
      ];

      const results = await retrieveRelevantContent('ai', preprocessedJson, 50000, 10);
      expect(results).toEqual(['first segment']);
    });
  });

  describe('processSegment / runSegmentationAndProcessing', () => {
    it('processSegment should fail gracefully without window.ChatbotCore', async () => {
      const result = await processSegment('hello');
      expect(result.summary).toBe('片段处理失败。');
      expect(result.length).toBe('hello'.length);
      expect(result.details.length).toBeGreaterThanOrEqual(1);
    });

    it('processSegment should call ChatbotCore.singleChunkSummary when available', async () => {
      const singleChunkSummary = vi.fn(async (_sysPrompt, segmentText) => `S:${segmentText}`);
      globalThis.window = {
        ChatbotCore: {
          getChatbotConfig: () => ({ apiKey: 'test-key' }),
          singleChunkSummary,
        },
      };

      const result = await processSegment('hello');
      expect(result).toEqual({ summary: 'S:hello', details: [], length: 5 });
      expect(singleChunkSummary).toHaveBeenCalledTimes(1);
      expect(singleChunkSummary.mock.calls[0][1]).toBe('hello');
      expect(String(singleChunkSummary.mock.calls[0][0])).toContain('不超过200字');
    });

    it('runSegmentationAndProcessing should segment + process + build JSON end-to-end', async () => {
      const singleChunkSummary = vi.fn(async (_sysPrompt, segmentText) => `S:${segmentText}`);
      globalThis.window = {
        chatbotActiveOptions: { segmentConcurrency: 1 },
        ChatbotCore: {
          getChatbotConfig: () => ({ apiKey: 'test-key' }),
          singleChunkSummary,
        },
      };

      const doc = ['# A', 'Para1.', '', 'Para2.', '', '# B', 'B content.'].join('\n');
      const result = await runSegmentationAndProcessing(doc, 'toc input');

      expect(singleChunkSummary).toHaveBeenCalledTimes(2);
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        tocTitle: 'A',
        tocLevel: 1,
        segments: [
          {
            originalText: 'Para1.\n\nPara2.',
            summary: 'S:Para1.\n\nPara2.',
            details: [],
            length: 'Para1.\n\nPara2.'.length,
          },
        ],
      });
      expect(result[1].tocTitle).toBe('B');
      expect(result[1].segments[0].summary).toBe('S:B content.');
    });

    it('processSegmentWithRetry should return the successful result without delays', async () => {
      const singleChunkSummary = vi.fn(async (_sysPrompt, segmentText) => `S:${segmentText}`);
      globalThis.window = {
        ChatbotCore: {
          getChatbotConfig: () => ({ apiKey: 'test-key' }),
          singleChunkSummary,
        },
      };

      const result = await processSegmentWithRetry('hello', 3, 1);
      expect(result).toEqual({ summary: 'S:hello', details: [], length: 5 });
      expect(singleChunkSummary).toHaveBeenCalledTimes(1);
    });
  });
});

