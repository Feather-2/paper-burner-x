import { describe, it, expect, vi, beforeEach } from 'vitest';

const cryptoMocks = vi.hoisted(() => ({
  randomUUID: vi.fn(() => 'mock-uuid'),
}));

vi.mock('node:crypto', () => cryptoMocks);

import { randomUUID } from 'node:crypto';
import {
  EventStatus,
  RuntimeEvents,
  ReviewEvents,
  CompressionEvents,
  ArchiveEvents,
  RouterEvents,
  WatchdogEvents,
  CicadaEvents,
  OrchestratorEvents,
  DeepSearchEvents,
  DesignEvents,
  IngestEvents,
  CodeSearchEvents,
  AgentLifecycleEvents,
  PhaseEvents,
  getEventPrefix,
  matchEventPattern,
} from '../../../../../js/agents/runtime/events/events.js';

const EXPECTED_EVENT_STATUS = {
  STARTED: 'started',
  PROGRESS: 'progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  WARNING: 'warning',
  INFO: 'info',
};

const EXPECTED_RUNTIME_EVENTS = {
  RUN_STARTED: 'run:started',
  RUN_COMPLETED: 'run:completed',
  RUN_FAILED: 'run:failed',
  RUN_CANCELLED: 'run:cancelled',
  STAGE_STARTED: 'stage:started',
  STAGE_PROGRESS: 'stage:progress',
  STAGE_COMPLETED: 'stage:completed',
  STAGE_FAILED: 'stage:failed',
  STAGE_INJECTED: 'stage:injected',
};

const EXPECTED_REVIEW_EVENTS = {
  REVIEW_STARTED: 'review:started',
  REVIEW_COMPLETED: 'review:completed',
  REVIEW_FAILED: 'review:failed',
};

const EXPECTED_COMPRESSION_EVENTS = {
  COMPRESSION_SCHEDULED: 'compression:scheduled',
  COMPRESSION_APPLIED: 'compression:applied',
  COMPRESSION_FAILED: 'compression:failed',
  COMPRESSION_ADVISED: 'compression:advised',
  COMPRESSION_FORCED: 'compression:forced',
};

const EXPECTED_ARCHIVE_EVENTS = {
  CHECKPOINT_SAVED: 'archive:checkpoint:saved',
  CHECKPOINT_RESTORED: 'archive:checkpoint:restored',
  CHECKPOINT_DELETED: 'archive:checkpoint:deleted',
};

const EXPECTED_ROUTER_EVENTS = {
  ROUTER_PLAN_START: 'router:plan:start',
  ROUTER_COMPLEXITY_ASSESSED: 'router:complexity:assessed',
  ROUTER_PIPELINE_ASSEMBLED: 'router:pipeline:assembled',
  ROUTER_BLOCK_SELECTED: 'router:block:selected',
};

const EXPECTED_WATCHDOG_EVENTS = {
  WATCHDOG_DELEGATED: 'watchdog:delegated',
  WATCHDOG_DECISION: 'watchdog:decision',
  WATCHDOG_COMPRESSED: 'watchdog:compressed',
  WATCHDOG_INTERVENTION: 'watchdog:intervention',
};

const EXPECTED_CICADA_EVENTS = {
  LAYER_COMPLETED: 'cicada:layer:completed',
  SHED_COMPLETED: 'cicada:shed:completed',
  DECISIONS_EXTRACTED: 'compression:decisions',
};

const EXPECTED_ORCHESTRATOR_EVENTS = {
  QUEUE_PRESSURE: 'orchestrator:queue:pressure',
  CONCURRENCY_WAIT: 'orchestrator:concurrency:wait',
  PARALLEL_BEGIN: 'parallel:begin',
  PARALLEL_END: 'parallel:end',
  GRAPH_BEGIN: 'graph:begin',
  GRAPH_END: 'graph:end',
};

const EXPECTED_DEEPSEARCH_EVENTS = {
  AGENT_STATUS_CHANGED: 'deepsearch:agent:status:changed',
  AGENT_STARTED: 'deepsearch:agent:started',
  AGENT_COMPLETED: 'deepsearch:agent:completed',
  AGENT_FAILED: 'deepsearch:agent:failed',
  AGENT_PAUSED: 'deepsearch:agent:paused',
  AGENT_ITERATION: 'deepsearch:agent:iteration',
  AGENT_ERROR: 'deepsearch:agent:error',
  MODEL_RESPONDED: 'deepsearch:model:responded',
  SECTION_WRITTEN: 'deepsearch:section:written',
  REPORT_GENERATED: 'deepsearch:report:generated',
  EVIDENCE_SYNTHESIZED: 'deepsearch:evidence:synthesized',
  DRAFT_UPDATED: 'deepsearch:draft:updated',
  TODO_CREATED: 'deepsearch:todo:created',
  TODO_UPDATED: 'deepsearch:todo:updated',
  TODO_COMPLETED: 'deepsearch:todo:completed',
  TODO_CANCELLED: 'deepsearch:todo:cancelled',
  SEARCH_COMPLETED: 'deepsearch:search:completed',
  AGENT_BACKTRACKED: 'deepsearch:agent:backtracked',
  AGENT_BACKTRACK_LIMIT: 'deepsearch:agent:backtrack_limit',
};

const EXPECTED_DESIGN_EVENTS = {
  STARTED: 'design:started',
  COMPLETED: 'design:completed',
  DECK_UPDATED: 'design:deck:updated',
  TOKENS_STARTED: 'design:tokens:started',
  TOKENS_COMPLETED: 'design:tokens:completed',
  BRAINSTORM_STARTED: 'design:brainstorm:started',
  BRAINSTORM_PROGRESS: 'design:brainstorm:progress',
  BRAINSTORM_BATCH_STARTED: 'design:brainstorm:batch:started',
  BRAINSTORM_BATCH_ERROR: 'design:brainstorm:batch:error',
  BRAINSTORM_LLM_GENERATED: 'design:brainstorm:llm:generated',
  BRAINSTORM_SLIDE_COMPLETED: 'design:brainstorm:slide:completed',
  BRAINSTORM_CANDIDATES: 'design:brainstorm:candidates',
  BRAINSTORM_COMPLETED: 'design:brainstorm:completed',
  GENERATE_STARTED: 'design:generate:started',
  GENERATE_PROGRESS: 'design:generate:progress',
  GENERATE_COMPLETED: 'design:generate:completed',
  BATCH_STARTED: 'design:batch:started',
  BATCH_PROGRESS: 'design:batch:progress',
  BATCH_COMPLETED: 'design:batch:completed',
  IMAGE_STARTED: 'design:image:started',
  IMAGE_PROGRESS: 'design:image:progress',
  IMAGE_COMPLETED: 'design:image:completed',
  IMAGE_PLANNING_COMPLETED: 'design:image:planning:completed',
  IMAGE_GENERATE_STARTED: 'design:image:generate:started',
  IMAGE_GENERATE_SKIPPED: 'design:image:generate:skipped',
  IMAGE_GENERATE_SUCCEEDED: 'design:image:generate:succeeded',
  IMAGE_GENERATE_FAILED: 'design:image:generate:failed',
  IMAGE_FILL_COMPLETED: 'design:image:fill:completed',
  VISUAL_RENDER_STARTED: 'design:visual:render:started',
  VISUAL_RENDER_COMPLETED: 'design:visual:render:completed',
  VISUAL_RENDER_FAILED: 'design:visual:render:failed',
  REFINE_STARTED: 'design:refine:started',
  REFINE_STEP: 'design:refine:step',
  REFINE_FINISH_ACCEPTED: 'design:refine:finish_accepted',
  REFINE_HARD_LIMIT: 'design:refine:hard_limit',
  REFINE_COMPLETED: 'design:refine:completed',
  QA_STARTED: 'design:qa:started',
  QA_COMPLETED: 'design:qa:completed',
  DEGRADED: 'design:degraded',
};

const EXPECTED_INGEST_EVENTS = {
  STARTED: 'ingest:started',
  COMPLETED: 'ingest:completed',
  DOC_STARTED: 'ingest:doc:started',
  DOC_COMPLETED: 'ingest:doc:completed',
  DOC_FAILED: 'ingest:doc:failed',
  ASSETS_UNDERSTANDING_STARTED: 'ingest:assets:understanding:started',
  ASSETS_UNDERSTANDING_PROGRESS: 'ingest:assets:understanding:progress',
  ASSETS_UNDERSTANDING_COMPLETED: 'ingest:assets:understanding:completed',
  ASSETS_UNDERSTANDING_FAILED: 'ingest:assets:understanding:failed',
};

const EXPECTED_CODESEARCH_EVENTS = {
  AGENT_STATUS_CHANGED: 'codesearch:agent:status:changed',
  STARTED: 'codesearch:started',
  COMPLETED: 'codesearch:completed',
  FAILED: 'codesearch:failed',
  PHASE_TRANSITION: 'codesearch:phase:transition',
  STEP_STARTED: 'codesearch:step:started',
  STEP_COMPLETED: 'codesearch:step:completed',
  STEP_FAILED: 'codesearch:step:failed',
  TODO_CREATED: 'codesearch:todo:created',
  TODO_UPDATED: 'codesearch:todo:updated',
  TODO_COMPLETED: 'codesearch:todo:completed',
};

const EXPECTED_AGENT_LIFECYCLE_EVENTS = {
  STATUS_CHANGED: 'agent:status:changed',
  STARTED: 'agent:started',
  COMPLETED: 'agent:completed',
  FAILED: 'agent:failed',
  PAUSED: 'agent:paused',
  RESUMED: 'agent:resumed',
  ITERATION: 'agent:iteration',
  // Multi-agent coordination (Phase 1)
  IDLE: 'agent:idle',
  BUSY: 'agent:busy',
  STOPPED: 'agent:stopped',
  DEGRADED: 'agent:degraded',
};

const EXPECTED_PHASE_EVENTS = {
  TRANSITION: 'phase:transition',
  STARTED: 'phase:started',
  COMPLETED: 'phase:completed',
};

const enumCases = [
  { name: 'EventStatus', value: EventStatus, expected: EXPECTED_EVENT_STATUS },
  { name: 'RuntimeEvents', value: RuntimeEvents, expected: EXPECTED_RUNTIME_EVENTS },
  { name: 'ReviewEvents', value: ReviewEvents, expected: EXPECTED_REVIEW_EVENTS },
  { name: 'CompressionEvents', value: CompressionEvents, expected: EXPECTED_COMPRESSION_EVENTS },
  { name: 'ArchiveEvents', value: ArchiveEvents, expected: EXPECTED_ARCHIVE_EVENTS },
  { name: 'RouterEvents', value: RouterEvents, expected: EXPECTED_ROUTER_EVENTS },
  { name: 'WatchdogEvents', value: WatchdogEvents, expected: EXPECTED_WATCHDOG_EVENTS },
  { name: 'CicadaEvents', value: CicadaEvents, expected: EXPECTED_CICADA_EVENTS },
  { name: 'OrchestratorEvents', value: OrchestratorEvents, expected: EXPECTED_ORCHESTRATOR_EVENTS },
  { name: 'DeepSearchEvents', value: DeepSearchEvents, expected: EXPECTED_DEEPSEARCH_EVENTS },
  { name: 'DesignEvents', value: DesignEvents, expected: EXPECTED_DESIGN_EVENTS },
  { name: 'IngestEvents', value: IngestEvents, expected: EXPECTED_INGEST_EVENTS },
  { name: 'CodeSearchEvents', value: CodeSearchEvents, expected: EXPECTED_CODESEARCH_EVENTS },
  { name: 'AgentLifecycleEvents', value: AgentLifecycleEvents, expected: EXPECTED_AGENT_LIFECYCLE_EVENTS },
  { name: 'PhaseEvents', value: PhaseEvents, expected: EXPECTED_PHASE_EVENTS },
];

const assertFrozenEnum = (actual, expected) => {
  expect(actual).toEqual(expected);
  expect(Object.isFrozen(actual)).toBe(true);
  expect(Object.isExtensible(actual)).toBe(false);
  const values = Object.values(actual);
  expect(values.length).toBe(Object.keys(expected).length);
  for (const value of values) {
    expect(typeof value).toBe('string');
    expect(value.length).toBeGreaterThan(0);
  }
  expect(new Set(values).size).toBe(values.length);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe.each(enumCases)('$name', ({ value, expected }) => {
  it('matches expected enum values', () => {
    assertFrozenEnum(value, expected);
  });

  it('is immutable', () => {
    expect(Reflect.set(value, 'NEW_KEY', 'new_value')).toBe(false);
    expect(value.NEW_KEY).toBeUndefined();

    const firstKey = Object.keys(expected)[0];
    expect(Reflect.deleteProperty(value, firstKey)).toBe(false);
    expect(value[firstKey]).toBe(expected[firstKey]);
  });
});

describe('getEventPrefix', () => {
  it('extracts the prefix from standard event names', () => {
    expect(getEventPrefix(RuntimeEvents.RUN_STARTED)).toBe('run');
    expect(getEventPrefix(ArchiveEvents.CHECKPOINT_SAVED)).toBe('archive');
    expect(getEventPrefix(DeepSearchEvents.AGENT_COMPLETED)).toBe('deepsearch');
  });

  it('handles numeric-like prefixes and empty segments', () => {
    expect(getEventPrefix('123:started')).toBe('123');
    expect(getEventPrefix('0:progress')).toBe('0');
    expect(getEventPrefix(':started')).toBe('');
    expect(getEventPrefix('trail:')).toBe('trail');
  });

  it('returns null for invalid or boundary inputs', () => {
    const invalidInputs = [
      null,
      undefined,
      '',
      '   ',
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      { length: 1, 0: 'a' },
      'noDelimiter',
    ];

    for (const input of invalidInputs) {
      expect(getEventPrefix(input)).toBeNull();
    }
  });

  it('supports deep nesting and long event names', () => {
    const deepSegments = Array.from({ length: 250 }, (_, index) => `seg${index}`);
    const deepEvent = `deep:${deepSegments.join(':')}`;
    expect(getEventPrefix(deepEvent)).toBe('deep');

    const longEvent = `long:${'a'.repeat(100000)}`;
    expect(getEventPrefix(longEvent)).toBe('long');
  });

  it('supports concurrent calls', async () => {
    const prefix = `batch-${randomUUID()}`;
    const names = Array.from({ length: 30 }, (_, index) => `${prefix}:step:${index}`);

    const results = await Promise.all(names.map((name) => Promise.resolve(getEventPrefix(name))));

    expect(new Set(results)).toEqual(new Set([prefix]));
    expect(cryptoMocks.randomUUID).toHaveBeenCalledTimes(1);
  });
});

describe('matchEventPattern', () => {
  it('matches exact names and wildcard patterns', () => {
    expect(matchEventPattern(RuntimeEvents.RUN_STARTED, RuntimeEvents.RUN_STARTED)).toBe(true);
    expect(matchEventPattern(RuntimeEvents.RUN_STARTED, RuntimeEvents.RUN_COMPLETED)).toBe(false);
    expect(matchEventPattern('*', RuntimeEvents.RUN_FAILED)).toBe(true);
  });

  it('handles invalid inputs and boundary types', () => {
    const invalidValues = [
      null,
      undefined,
      [],
      {},
      0,
      -1,
      Number.MAX_SAFE_INTEGER,
      { length: 1, 0: 'x' },
    ];

    for (const pattern of invalidValues) {
      expect(matchEventPattern(pattern, RuntimeEvents.RUN_STARTED)).toBe(false);
    }

    for (const name of invalidValues) {
      expect(matchEventPattern(RuntimeEvents.RUN_STARTED, name)).toBe(false);
    }

    expect(matchEventPattern('', '')).toBe(true);
    expect(matchEventPattern('', RuntimeEvents.RUN_STARTED)).toBe(false);
    expect(matchEventPattern('   ', '   ')).toBe(true);
  });

  it('supports prefix shortcut patterns', () => {
    expect(matchEventPattern('design:*', DesignEvents.STARTED)).toBe(true);
    expect(matchEventPattern('design:*', 'design')).toBe(true);
    expect(matchEventPattern('design:*', 'designX:started')).toBe(false);
  });

  it('supports wildcard ? and * across segments', () => {
    expect(matchEventPattern('run:st?rt*', 'run:started')).toBe(true);
    expect(matchEventPattern('run:st?rt*', 'run:stxrted')).toBe(true);
    expect(matchEventPattern('run:st?rt*', 'run:strted')).toBe(false);

    expect(matchEventPattern('deepsearch:*:completed', DeepSearchEvents.AGENT_COMPLETED)).toBe(true);
    expect(matchEventPattern('deepsearch:*:completed', DeepSearchEvents.AGENT_FAILED)).toBe(false);
  });

  it('treats numeric-like strings as literal patterns', () => {
    expect(matchEventPattern('123', '123')).toBe(true);
    expect(matchEventPattern('123', 123)).toBe(false);
  });

  it('handles long strings, large payloads, and deep nesting safely', () => {
    const longName = `file:${'b'.repeat(200000)}`;
    expect(matchEventPattern('file:*', longName)).toBe(true);

    const deepSegments = Array.from({ length: 300 }, (_, index) => `node${index}`);
    const deepName = `deep:${deepSegments.join(':')}`;
    expect(matchEventPattern('deep:*', deepName)).toBe(true);

    const longPattern = `long:${'c'.repeat(100000)}*`;
    const longTarget = `long:${'c'.repeat(100000)}tail`;
    expect(matchEventPattern(longPattern, longTarget)).toBe(true);
  });

  it('handles rapid consecutive calls', () => {
    for (let index = 0; index < 500; index += 1) {
      expect(matchEventPattern('router:*', RouterEvents.ROUTER_BLOCK_SELECTED)).toBe(true);
    }
  });

  it('supports concurrent calls with unique prefixes', async () => {
    const prefix = `prefix-${randomUUID()}`;
    const names = Array.from({ length: 25 }, (_, index) => `${prefix}:step:${index}`);

    const results = await Promise.all(
      names.map((name) => Promise.resolve(matchEventPattern(`${prefix}:*`, name)))
    );

    expect(results.every(Boolean)).toBe(true);
    expect(cryptoMocks.randomUUID).toHaveBeenCalledTimes(1);
  });
});
