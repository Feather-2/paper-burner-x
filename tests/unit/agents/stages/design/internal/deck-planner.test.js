import { beforeEach, describe, expect, it, vi } from 'vitest';

function defaultToNonEmptyString(value) {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length ? s : undefined;
}

const sharedMocks = vi.hoisted(() => ({
  toNonEmptyString: vi.fn(defaultToNonEmptyString),
}));

vi.mock('../../../../../../js/agents/shared/index.js', () => ({
  toNonEmptyString: sharedMocks.toNonEmptyString,
  protoSafeReviver: (_key, value) => value,
}));

import {
  planDeck,
  applyUserEdits,
  formatPlanForReview,
  formatPlanForDialog,
  parseSimpleFeedback,
  parseFeedbackWithLLM,
  DeckPlanner,
} from '../../../../../../js/agents/stages/design/internal/deck-planner.js';

beforeEach(() => {
  vi.clearAllMocks();
  sharedMocks.toNonEmptyString.mockImplementation(defaultToNonEmptyString);
});

describe('planDeck', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty array', []],
    ['empty object', {}],
    ['zero', 0],
  ])('returns empty plan for %s input', (_label, input) => {
    const result = planDeck(input);
    expect(result).toEqual({ plans: [], summary: 'No slides to plan' });
  });

  it('creates plans with defaults, density, and summary', () => {
    const longTitle = 'Comparison of options across multiple dimensions';
    const slideIntents = [
      { pageType: 'content', title: 'Intro', keyPoints: ['a'] },
      {
        pageType: 'comparison',
        title: longTitle,
        keyPoints: ['a', 'b', 'c', 'd', 'e', 'f'],
      },
      { pageType: 'bullet', title: 'Next steps', keyPoints: ['a', 'b', 'c'] },
    ];

    const result = planDeck(slideIntents, { theme: 'dark' });

    expect(result.summary).toBe(
      '3 slides planned: content, comparison, bullet. Density: 1H/1M/1L'
    );
    expect(result.metadata).toEqual({
      totalSlides: 3,
      pageTypes: ['content', 'comparison', 'bullet'],
      densityDistribution: { high: 1, medium: 1, low: 1 },
      theme: 'dark',
    });

    expect(result.plans[0]).toMatchObject({
      slideIndex: 0,
      pageType: 'content',
      title: 'Intro',
      visualFocus: 'center',
      layoutHint: 'spacious',
      keyMessage: 'points',
      visualIntent: '留白充足，聚焦重点',
      contentDensity: 'low',
      suggestedEmphasis: 'brand',
    });
    expect(result.plans[0].sellingPoint).toBe(
      '通过「Intro」传递关键论点和支撑证据'
    );

    const titleSnippet = longTitle.slice(0, 20);
    expect(result.plans[1]).toMatchObject({
      slideIndex: 1,
      pageType: 'comparison',
      visualFocus: 'split',
      layoutHint: 'dense-list',
      keyMessage: 'contrast',
      visualIntent: '信息密集，高效传递',
      contentDensity: 'high',
      suggestedEmphasis: 'content',
    });
    expect(result.plans[1].sellingPoint).toBe(
      `通过「${titleSnippet}...」突出优势或展示选择`
    );

    expect(result.plans[2]).toMatchObject({
      slideIndex: 2,
      pageType: 'bullet',
      visualFocus: 'left',
      layoutHint: 'list',
      keyMessage: 'cta',
      visualIntent: '简洁有力，逐条呈现',
      contentDensity: 'medium',
      suggestedEmphasis: 'action',
    });
    expect(result.plans[2].sellingPoint).toBe(
      '通过「Next steps」快速传递多个要点'
    );
  });

  it('falls back for empty pageType and unknown types', () => {
    const result = planDeck([
      { pageType: '   ', keyPoints: [] },
      { pageType: 'mystery', keyPoints: ['a', 'b', 'c'] },
    ]);

    expect(result.plans[0].pageType).toBe('content');
    expect(result.plans[0].layoutHint).toBe('spacious');
    expect(result.plans[1].pageType).toBe('mystery');
    expect(result.plans[1].layoutHint).toBe('standard');
    expect(result.plans[1].sellingPoint).toBe('推动观众采取行动');
  });

  it('handles large slide sets and deep nesting', () => {
    const deepNested = { level1: { level2: { level3: { value: 'x' } } } };
    const largeKeyPoints = Array.from({ length: 10000 }, (_, i) => `p${i}`);
    const slideIntents = Array.from({ length: 200 }, (_, i) => ({
      pageType: 'content',
      title: `Slide ${i}`,
      keyPoints: i === 0 ? largeKeyPoints : ['a', 'b', 'c'],
      meta: deepNested,
    }));

    const result = planDeck(slideIntents);

    expect(result.plans).toHaveLength(200);
    expect(result.plans[0].contentDensity).toBe('high');
    expect(result.plans[0].layoutHint).toBe('dense-list');
    expect(result.plans[0].slideIntentId).toBe('slide_0');
  });

  it('supports rapid consecutive calls without shared state', () => {
    const first = planDeck([{ pageType: 'content', keyPoints: [] }]);
    const second = planDeck([{ pageType: 'summary', keyPoints: ['a', 'b', 'c'] }]);

    expect(first.plans[0].pageType).toBe('content');
    expect(second.plans[0].pageType).toBe('summary');
  });
});

describe('applyUserEdits', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty object', {}],
    ['string', 'edits'],
  ])('returns original plans for %s edits', (_label, edits) => {
    const plans = [
      {
        slideIntentId: 'a',
        visualFocus: 'left',
        layoutHint: 'list',
        keyMessage: 'points',
        visualIntent: 'intent',
        sellingPoint: 'sell',
      },
    ];

    const result = applyUserEdits(plans, edits);

    expect(result).toBe(plans);
  });

  it('applies edits by id and index while ignoring blanks and invalid indexes', () => {
    const plans = [
      {
        slideIntentId: 'a',
        visualFocus: 'left',
        layoutHint: 'list',
        keyMessage: 'points',
        visualIntent: 'intent-a',
        sellingPoint: 'sell-a',
      },
      {
        slideIntentId: 'b',
        visualFocus: 'center',
        layoutHint: 'hero',
        keyMessage: 'title',
        visualIntent: 'intent-b',
        sellingPoint: 'sell-b',
      },
      {
        slideIntentId: 'c',
        visualFocus: 'right',
        layoutHint: 'grid',
        keyMessage: 'cta',
        visualIntent: 'intent-c',
        sellingPoint: 'sell-c',
      },
    ];

    const edits = [
      {
        slideIntentId: 'a',
        visualFocus: 'right',
        layoutHint: 'grid',
        keyMessage: '',
        visualIntent: '   ',
        sellingPoint: null,
      },
      { slideIndex: 1, layoutHint: 'timeline', sellingPoint: 'new-sell' },
      { slideIndex: -1, layoutHint: 'hero' },
      { slideIntentId: 'missing', layoutHint: 'list' },
      { slideIndex: '0', layoutHint: 'list' },
    ];

    const result = applyUserEdits(plans, edits);

    expect(result[0]).toMatchObject({
      slideIntentId: 'a',
      visualFocus: 'right',
      layoutHint: 'grid',
      keyMessage: 'points',
      visualIntent: 'intent-a',
      sellingPoint: 'sell-a',
      userOverride: true,
    });
    expect(result[1]).toMatchObject({
      slideIntentId: 'b',
      layoutHint: 'timeline',
      sellingPoint: 'new-sell',
      userOverride: true,
    });
    expect(result[2]).toBe(plans[2]);
  });
});

describe('formatPlanForReview', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty array', []],
    ['empty object', {}],
  ])('returns placeholder for %s input', (_label, plans) => {
    expect(formatPlanForReview(plans)).toBe('No plans to review.');
  });

  it('formats a table with headers and truncates long titles', () => {
    const longTitle = '0123456789'.repeat(3) + 'TAIL';
    const plans = [
      {
        pageType: 'content',
        title: longTitle,
        layoutHint: 'two-column',
        visualFocus: 'left',
      },
    ];

    const output = formatPlanForReview(plans);
    const lines = output.split('\n');

    expect(lines[0]).toBe('=== Deck Plan ===');
    expect(lines[1]).toBe(
      'No. Type         Title                          Layout          Focus'
    );
    expect(lines[2]).toBe('-'.repeat(80));
    expect(lines[4]).toBe('-'.repeat(80));

    const planLine = lines[3];
    const truncated = longTitle.slice(0, 30);
    const tail = longTitle.slice(30);

    expect(planLine).toContain('[content');
    expect(planLine).toContain('two-column');
    expect(planLine).toContain('left');
    expect(planLine).toContain(truncated);
    expect(planLine).not.toContain(tail);
  });
});

describe('formatPlanForDialog', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty array', []],
  ])('returns empty dialog for %s input', (_label, plans) => {
    expect(formatPlanForDialog(plans)).toEqual({ text: '暂无规划内容。', cards: [] });
  });

  it('formats dialog text, cards, and instructions', () => {
    const plans = [
      {
        slideIntentId: 'slide-1',
        title: 'Intro',
        pageType: 'content',
        layoutHint: 'list',
        visualIntent: 'intent-1',
        sellingPoint: 'sell-1',
      },
      {
        slideIntentId: 'slide-2',
        pageType: 'summary',
        layoutHint: 'summary',
        visualIntent: 'intent-2',
        sellingPoint: 'sell-2',
      },
    ];

    const result = formatPlanForDialog(plans);

    expect(result.cards).toHaveLength(2);
    expect(result.cards[0]).toEqual({
      slideNo: 1,
      slideIntentId: 'slide-1',
      title: 'Intro',
      pageType: 'content',
      layoutHint: 'list',
      visualIntent: 'intent-1',
      sellingPoint: 'sell-1',
      editable: ['layoutHint', 'visualIntent', 'sellingPoint'],
    });
    expect(result.cards[1].title).toBe('(未命名)');

    expect(result.text).toContain('第 1 页');
    expect(result.text).toContain('📐 布局: list');
    expect(result.text).toContain('🎯 视觉初衷: intent-2');
    expect(result.text).toContain('💡 核心卖点: sell-2');
    expect(result.instructions).toEqual([
      '示例调整指令：',
      '- 「第3页用瀑布流展示」',
      '- 「第5页要对比两个产品」',
      '- 「把第2页改成时间线布局」',
    ]);
  });
});

describe('parseSimpleFeedback', () => {
  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty string', ''],
    ['whitespace', '   '],
    ['number', 0],
    ['object', {}],
    ['array', []],
  ])('returns empty list for %s feedback', (_label, feedback) => {
    expect(parseSimpleFeedback(feedback, [])).toEqual([]);
  });

  it('parses layout keywords and ignores invalid lines', () => {
    const plans = [{}, {}, {}];
    const feedback =
      '第1页用瀑布流展示, 第3页要对比两个产品；第2页居中；第4页要图表；第0页全图；第1页谢谢';

    const result = parseSimpleFeedback(feedback, plans);

    expect(result).toEqual([
      { slideIndex: 0, layoutHint: 'waterfall' },
      { slideIndex: 2, layoutHint: 'two-column' },
      { slideIndex: 1, layoutHint: 'hero' },
    ]);
  });
});

describe('parseFeedbackWithLLM', () => {
  it.each([
    ['missing llmCall', '第1页用瀑布流展示', null],
    ['empty feedback', '', vi.fn()],
    ['non-string feedback', 0, vi.fn()],
  ])('falls back to simple parser for %s', async (_label, feedback, llmCall) => {
    const plans = [{ pageType: 'content', title: 'A', layoutHint: 'list' }];
    const expected = parseSimpleFeedback(feedback, plans);

    const result = await parseFeedbackWithLLM(feedback, plans, llmCall);

    expect(result).toEqual(expected);
  });

  it('parses LLM JSON, filters invalid edits, and truncates fields', async () => {
    const longLayout = 'l'.repeat(100);
    const longVisual = 'v'.repeat(300);
    const longSelling = 's'.repeat(300);
    const response = [
      {
        slideIndex: '1',
        layoutHint: 'timeline',
        visualIntent: 'Intent',
        sellingPoint: 'Sell',
        extra: { deep: { nest: { value: true } } },
      },
      { slideIndex: -1, layoutHint: 'hero' },
      { slideIndex: 0, layoutHint: 123 },
      { slideIndex: Number.MAX_SAFE_INTEGER, layoutHint: 'list' },
      {
        slideIndex: 0,
        layoutHint: longLayout,
        visualIntent: longVisual,
        sellingPoint: longSelling,
      },
    ];

    const llmCall = vi.fn(
      async () => `\`\`\`json\n${JSON.stringify(response)}\n\`\`\``
    );
    const plans = [
      { pageType: 'content', title: 'A', layoutHint: 'list' },
      { pageType: 'content', title: 'B', layoutHint: 'list' },
    ];

    const result = await parseFeedbackWithLLM('反馈', plans, llmCall);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      slideIndex: 1,
      layoutHint: 'timeline',
      visualIntent: 'Intent',
      sellingPoint: 'Sell',
    });
    expect(result[1]).toMatchObject({ slideIndex: 0 });
    expect(result[1].layoutHint).toBe(longLayout.slice(0, 50));
    expect(result[1].visualIntent).toBe(longVisual.slice(0, 200));
    expect(result[1].sellingPoint).toBe(longSelling.slice(0, 200));
  });

  it('falls back with warning when LLM output is invalid JSON', async () => {
    const feedback = '第1页用瀑布流展示';
    const plans = [{ pageType: 'content', title: 'A', layoutHint: 'list' }];
    const llmCall = vi.fn(async () => '```json\nnot json\n```');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await parseFeedbackWithLLM(feedback, plans, llmCall);

    expect(result).toEqual(parseSimpleFeedback(feedback, plans));
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('returns empty list when LLM output is not an array', async () => {
    const llmCall = vi.fn(async () => '{"slideIndex":0}');
    const plans = [{ pageType: 'content', title: 'A', layoutHint: 'list' }];

    const result = await parseFeedbackWithLLM('feedback', plans, llmCall);

    expect(result).toEqual([]);
  });

  it('supports concurrent LLM parsing calls', async () => {
    const llmCall = vi.fn(async (prompt) => {
      if (prompt.includes('反馈A')) {
        return '[{"slideIndex":0,"layoutHint":"hero"}]';
      }
      return '[{"slideIndex":0,"layoutHint":"list"}]';
    });
    const plans = [{ pageType: 'content', title: 'A', layoutHint: 'list' }];

    const [resultA, resultB] = await Promise.all([
      parseFeedbackWithLLM('反馈A', plans, llmCall),
      parseFeedbackWithLLM('反馈B', plans, llmCall),
    ]);

    expect(resultA).toEqual([{ slideIndex: 0, layoutHint: 'hero' }]);
    expect(resultB).toEqual([{ slideIndex: 0, layoutHint: 'list' }]);
  });
});

describe('DeckPlanner', () => {
  it('delegates plan, applyEdits, and format methods', () => {
    const planner = new DeckPlanner();
    const planResult = planner.plan(
      [{ pageType: 'content', title: 'Intro', keyPoints: [] }],
      { theme: 'light' }
    );

    expect(planResult.plans).toHaveLength(1);

    const edited = planner.applyEdits(planResult.plans, [
      { slideIndex: 0, layoutHint: 'hero' },
    ]);
    expect(edited[0].layoutHint).toBe('hero');

    const formatted = planner.format(planResult.plans);
    expect(formatted).toContain('=== Deck Plan ===');

    const dialog = planner.formatForDialog(planResult.plans);
    expect(dialog.cards[0].slideIntentId).toBe(planResult.plans[0].slideIntentId);
  });

  it('uses LLM parsing when llmCall is provided', async () => {
    const llmCall = vi.fn(async () => '[{"slideIndex":0,"layoutHint":"timeline"}]');
    const planner = new DeckPlanner({ llmCall });
    const plans = [
      {
        slideIntentId: 's1',
        title: 'Intro',
        pageType: 'content',
        layoutHint: 'list',
        visualIntent: 'intent',
        sellingPoint: 'sell',
      },
    ];

    const result = await planner.parseFeedback('feedback', plans);

    expect(result).toEqual([{ slideIndex: 0, layoutHint: 'timeline' }]);
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('falls back to simple parsing when llmCall is missing', async () => {
    const planner = new DeckPlanner();
    const plans = [{ pageType: 'content', title: 'A', layoutHint: 'list' }];
    const feedback = '第1页用瀑布流展示';

    const result = await planner.parseFeedback(feedback, plans);

    expect(result).toEqual(parseSimpleFeedback(feedback, plans));
  });
});
