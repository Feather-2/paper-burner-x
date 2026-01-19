# events - 事件类型

运行时事件定义与事件总线兼容层。

## 核心文件

| 文件 | 职责 |
|------|------|
| `events.js` | 事件常量与匹配工具（EventStatus / *Events / getEventPrefix / matchEventPattern） |
| `event-bus.js` | 兼容层：重导出 core/event-bus 的 EventBus 等 |

## 事件类型

```javascript
// 事件状态
EventStatus = {
  STARTED: 'started',
  PROGRESS: 'progress',
  COMPLETED: 'completed',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  WARNING: 'warning',
  INFO: 'info',
};

// Runtime
RuntimeEvents = {
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

// ReviewRules
ReviewEvents = {
  REVIEW_STARTED: 'review:started',
  REVIEW_COMPLETED: 'review:completed',
  REVIEW_FAILED: 'review:failed',
};

// AsyncCompressor
CompressionEvents = {
  COMPRESSION_SCHEDULED: 'compression:scheduled',
  COMPRESSION_APPLIED: 'compression:applied',
  COMPRESSION_FAILED: 'compression:failed',
  COMPRESSION_ADVISED: 'compression:advised',
  COMPRESSION_FORCED: 'compression:forced',
};

// Archive
ArchiveEvents = {
  CHECKPOINT_SAVED: 'archive:checkpoint:saved',
  CHECKPOINT_RESTORED: 'archive:checkpoint:restored',
  CHECKPOINT_DELETED: 'archive:checkpoint:deleted',
};

// RouterAgent
RouterEvents = {
  ROUTER_PLAN_START: 'router:plan:start',
  ROUTER_COMPLEXITY_ASSESSED: 'router:complexity:assessed',
  ROUTER_PIPELINE_ASSEMBLED: 'router:pipeline:assembled',
  ROUTER_BLOCK_SELECTED: 'router:block:selected',
};

// Watchdog
WatchdogEvents = {
  WATCHDOG_DELEGATED: 'watchdog:delegated',
  WATCHDOG_DECISION: 'watchdog:decision',
  WATCHDOG_COMPRESSED: 'watchdog:compressed',
  WATCHDOG_INTERVENTION: 'watchdog:intervention',
};

// CicadaCompressor
CicadaEvents = {
  LAYER_COMPLETED: 'cicada:layer:completed',
  SHED_COMPLETED: 'cicada:shed:completed',
};

// DeepSearch
DeepSearchEvents = {
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

// Design
DesignEvents = {
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

// Ingest
IngestEvents = {
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

// CodeSearch
CodeSearchEvents = {
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

// Agent 生命周期
AgentLifecycleEvents = {
  STATUS_CHANGED: 'agent:status:changed',
  STARTED: 'agent:started',
  COMPLETED: 'agent:completed',
  FAILED: 'agent:failed',
  PAUSED: 'agent:paused',
  RESUMED: 'agent:resumed',
  ITERATION: 'agent:iteration',
};

// Phase
PhaseEvents = {
  TRANSITION: 'phase:transition',
  STARTED: 'phase:started',
  COMPLETED: 'phase:completed',
};
```

## 工具函数

```javascript
getEventPrefix(eventName); // -> 'domain' | null
matchEventPattern(pattern, eventName); // 支持 '*' / '?' 通配符
```

## 兼容导出

event-bus.js 重导出 core/event-bus 的 EventBus、LamportClock、RunStoreAdapter、createEventRecord、isValidEventName、matchPattern（默认导出为 EventBus）。