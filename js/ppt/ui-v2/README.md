# PPT Generator UI V2

## 架构

```
ui-v2/
├── core/
│   ├── event-bus.js      # 统一事件总线
│   ├── state-store.js    # 单一状态源
│   ├── view-router.js    # 视图路由
│   └── ui-utils.js       # HTML/图标辅助
├── views/
│   ├── base-view.js      # 视图基类
│   ├── upload-view.js    # 上传视图
│   ├── briefing-view.js  # 需求填写
│   ├── research-view.js  # 研究视图 (DeepSearch)
│   ├── review-view.js    # 审阅视图
│   └── design-view.js    # 设计视图
├── components/
│   ├── stepper.js        # 步骤指示器
│   ├── terminal.js       # 日志终端
│   └── progress.js       # 进度条
├── adapters/
│   └── agent-adapter.js  # PPTGenerator 事件适配器
└── index.js              # 入口
```

## 核心原则

1. **单一状态源**: 所有状态集中在 StateStore
2. **事件驱动**: Agent → EventBus → StateStore → Views
3. **视图无状态**: Views 只负责渲染，不持有业务状态
4. **样式复用**: 保持现有 CSS 类名不变

## 事件流

```
Agent emit → EventBus → StateStore update → Views re-render
     ↑                                           │
     └───────────── User Actions ←───────────────┘
```

## 状态结构

```javascript
{
  workflow: {
    state: 'idle' | 'researching' | 'reviewing' | 'designing' | 'completed',
    runId: string,
    error: null | string
  },
  deepsearch: {
    status: 'idle' | 'running' | 'paused' | 'completed',
    iteration: number,
    gaps: [],
    claims: [],
    progress: { phase, step, current, total }
  },
  design: {
    status: 'idle' | 'running' | 'completed',
    slides: [],
    currentSlide: number
  },
  ui: {
    view: 'upload' | 'briefing' | 'research' | 'review' | 'design',
    uploadStep: number,
    pendingStart: boolean,
    logs: [],
    modals: {}
  },
  data: {
    files: [],
    generationMode: 'deepsearch' | 'simple' | 'planned',
    workflowMode: 'auto' | 'guided' | 'manual',
    reportConfig: { reportLength, tone, audience, language },
    projectBrief: { taskGoal, projectSummary, audience, tone }
  }
}
```
