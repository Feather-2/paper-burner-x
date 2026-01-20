# Audit History - phases

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] 超时处理
*Archived: 2026-01-19T23:47:58.042Z*

- **File**: js/agents/stages/design/internal/phases/generating-phase.js:137
- **Description**: spawn_slide_agent 调用未显式设置超时/截止时间；若上游信号未包含超时策略，可能导致生成阶段长期阻塞。
- **Suggestion**: 在调用层显式设置超时（如 AbortSignal.timeout）或在 startExecution 中绑定 deadline，并在超时后返回友好错误。
```
const genResult = await loop._callTool(
  "spawn_slide_agent",
  {
    slideIntents,
    contentPackage,
    designSystem,
    batchSize: loop.batchSize,
    batchConcurrency: loop.batchConcurrency,
    modelRouter,
    aiApiService: context.aiApiService,
    imageSlots,
    selectedIdeas: selectedIdeasForPrompt,
    emit,
    signal: generatingContext.signal,
    dslRules,
  },
  generatingContext
);
```

---

## Archived: 2026-01-19

### [RESOLVED] 输入验证
*Archived: 2026-01-19T23:47:42.708Z*

- **File**: js/agents/stages/design/internal/phases/planning-phase.js:67
- **Description**: planConfirmResult.edits/plans 直接应用，缺少结构与边界校验；错误或恶意输入可能导致后续阶段计划与 slideIntents 不一致。
- **Suggestion**: 为 edits/plans 增加 schema 校验，校验 slideIntentId/length/字段范围；不合法输入应拒绝或回退原计划。
```
if (planConfirmResult && typeof planConfirmResult === "object") {
  if (Array.isArray(planConfirmResult.edits)) {
    plans = applyUserEdits(plans, planConfirmResult.edits);
  }
  if (Array.isArray(planConfirmResult.plans)) {
    plans = planConfirmResult.plans;
  }
}
```

---

## Archived: 2026-01-19

### [RESOLVED] 资源边界/输入验证
*Archived: 2026-01-19T23:47:14.781Z*

- **File**: js/agents/stages/design/internal/phases/visual-phase.js:233
- **Description**: refine 的 recommendedSteps/hardLimit 直接取 userConfig 值，缺少数值校验与上限；错误或过大配置可能导致长时间运行或资源耗尽。
- **Suggestion**: 对 recommendedSteps/hardLimit 做类型校验并 clamp 到安全区间（例如 1-10/1-30），超限时回退默认值或中止。
```
const refineResult = await runReactRefiner(
  toolContext.deckPackage,
  { contentPackage, runContext, stageApi: context },
  {
    recommendedSteps: userConfig.refine.recommendedSteps || DESIGN_PHASE_DEFAULTS.refineRecommendedSteps,
    hardLimit: userConfig.refine.hardLimit || DESIGN_PHASE_DEFAULTS.refineHardLimit,
    toolExecutor,
    mode: "generation",
    onStep: (step) => emit?.("design.refine.step", { actor: "design", status: "step", payload: step }),
  }
);
```

---

## Archived: 2026-01-19

### [RESOLVED] 输入验证
*Archived: 2026-01-19T23:47:09.892Z*

- **File**: js/agents/stages/design/internal/phases/preparation-phase.js:114
- **Description**: styleConfirmResult 的 theme/font/color 直接写入 designSystem，缺少格式/范围校验；若 UI 可控，可能注入非法 token 或引发 CSS 异常。
- **Suggestion**: 对 theme/colorScheme/fontFamily/accentColor 使用白名单或格式校验（颜色正则、字体列表），非法值回退默认。
```
if (styleConfirmResult && typeof styleConfirmResult === "object") {
  if (styleConfirmResult.colorScheme) designSystem.colorScheme = styleConfirmResult.colorScheme;
  if (styleConfirmResult.fontFamily) designSystem.fontFamily = styleConfirmResult.fontFamily;
  if (styleConfirmResult.accentColor) designSystem.accentColor = styleConfirmResult.accentColor;
  if (styleConfirmResult.theme) designSystem.theme = styleConfirmResult.theme;
}
```

---

## Archived: 2026-01-19

### [RESOLVED] XSS/输入验证
*Archived: 2026-01-19T23:47:04.423Z*

- **File**: js/agents/stages/design/internal/phases/layout-phase.js:69
- **Description**: 用户确认阶段允许直接替换 layouts；若 UI 传入包含恶意 HTML 的 layoutHtml，后续预览/渲染可能触发 XSS 或破坏 DSL 结构。
- **Suggestion**: 对 layoutConfirmResult.layouts 做 schema 校验并过滤 layoutHtml（或仅接受结构化字段、服务端重新生成 HTML），必要时进行 HTML 白名单/转义。
```
if (layoutConfirmResult && typeof layoutConfirmResult === "object" && Array.isArray(layoutConfirmResult.layouts)) {
  layouts.splice(0, layouts.length, ...layoutConfirmResult.layouts);
  loop._blackboard?.logDecision("layout_edited", "User modified layouts");
}
```

---

