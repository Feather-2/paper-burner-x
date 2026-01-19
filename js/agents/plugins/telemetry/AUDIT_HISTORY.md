# Audit History - telemetry

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] JSDoc Any Type
*Archived: 2026-01-19T20:44:13.977Z*

- **File**: js/agents/plugins/telemetry/replay-controller.js:40
- **Description**: 构造器类型注解使用 `Array<any>` 与 `record: any`，不符合 no-any 规范。
- **Suggestion**: 新增 ReplayEvent typedef，并将 `Array<any>`/`record: any` 替换为具体类型或 `unknown`。
```
   * @param {{ getEvents: (runId: string) => (Promise<Array<any>>|Array<any>) }} [param0.runStore]
```

---

## Archived: 2026-01-19

### [RESOLVED] JSDoc Any Type
*Archived: 2026-01-19T20:44:06.434Z*

- **File**: js/agents/plugins/telemetry/trace-context.js:122
- **Description**: 公共 API 的 JSDoc 使用了被禁止的 `any` 类型。
- **Suggestion**: 改为 `unknown` 或更精确的联合类型（如 `string|number|boolean|Record<string, unknown>`）。
```
   * @param {any} value
```

---

## Archived: 2026-01-19

### [RESOLVED] Test Coverage Gap
*Archived: 2026-01-19T20:42:53.610Z*

- **File**: tests/integration/agents/runtime.test.js:926
- **Description**: subscribeTelemetry 仅覆盖正常路径，未覆盖 appendEvent 失败/flush 抛错及 meta.replay 过滤等边界错误场景。
- **Suggestion**: 补充 appendEvent 拒绝导致 flush() 抛错的测试，并验证 meta.replay 事件被跳过。
```
it("Runtime Telemetry: subscribeTelemetry keeps bounded in-memory timeline", async () => {
  const { EventBus } = await import("../../js/agents/core/event-bus.js");
  const { subscribeTelemetry } = await import("../../js/agents/runtime/telemetry/runstore-telemetry.js");
```

---

## Archived: 2026-01-19

### [RESOLVED] JSDoc Any Type
*Archived: 2026-01-19T20:42:40.676Z*

- **File**: js/agents/plugins/telemetry/loop-runtime-state.js:115
- **Description**: 返回类型中使用 `any`，违反 no-any 规范。
- **Suggestion**: 定义 LoopRuntimeCursor typedef（如 `string|Array<unknown>|Record<string, unknown>|null`）并替换 `any`。
```
   * @returns {{status: LoopRuntimeStatus, cursor: any, pausedReason: string|null, lastCheckpointId: string|null, statusHistory: Array<{from: string|null, to: string|null, timestamp: string}>}}
```

---

## Archived: 2026-01-19

### [RESOLVED] Prototype Pollution
*Archived: 2026-01-19T20:42:34.615Z*

- **File**: js/agents/plugins/telemetry/trace-context.js:124
- **Description**: Span attributes 存在使用未校验键写入普通对象的路径，若传入 "__proto__" 或 "constructor" 可能污染原型链。
- **Suggestion**: 用 Object.create(null) 初始化 attributes（或改用 Map），并在 setAttribute/setAttributes 中拦截危险键（"__proto__"/"constructor"/"prototype"）。
```
  setAttribute(key, value) {
    if (!this._ended) {
      this.attributes[key] = value;
    }
    return this;
  }
```

---

