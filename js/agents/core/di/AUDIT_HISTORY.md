# Audit History - di

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] 错误处理
*Archived: 2026-01-19T23:43:54.345Z*

- **File**: js/agents/core/di/container.js:120
- **Description**: tryGet 吞掉同步异常及异步 reject，服务初始化失败会被静默忽略，难以诊断问题。
- **Suggestion**: 记录日志或提供可选 error 回调；至少在开发模式抛出/告警，避免隐藏初始化失败。
```
try {
  const result = this.get(id);
  if (result && typeof result.then === "function") {
    return result.catch(() => undefined);
  }
  return result;
} catch {
  return undefined;
}
```

### [RESOLVED] JSDoc/类型
*Archived: 2026-01-19T23:43:54.345Z*

- **File**: js/agents/core/di/container.js:24
- **Description**: JSDoc 使用 any（如 #singletons），违反“禁止 any”规范，削弱类型契约。
- **Suggestion**: 改用 `Map<string, unknown>` 或定义 ServiceInstance @typedef，并同步替换其他 @type {any}。
```
/** @type {Map<string, any>} */
#singletons = new Map();
```

---

## Archived: 2026-01-19

### [RESOLVED] 错误处理
*Archived: 2026-01-19T23:42:06.319Z*

- **File**: js/agents/core/di/defaults.js:95
- **Description**: enableBackpressure 调用失败被空 catch 吞掉，背压未启用时可能导致事件堆积且不可见。
- **Suggestion**: 至少记录 warn 并保留错误上下文；在非生产环境可抛出以便及时发现。
```
if (typeof eventBus.enableBackpressure === "function") {
  try {
    eventBus.enableBackpressure({
      coalescePattern: /\.progress$/,
      deferNonCoalesced: false,
      maxQueueSize: 10000,
    });
  } catch {
    // ignore
  }
}
```

---

## Archived: 2026-01-19

### [RESOLVED] 插件隔离/全局状态
*Archived: 2026-01-19T23:41:40.860Z*

- **File**: js/agents/core/di/global-container.js:33
- **Description**: setGlobalContainer 允许任意调用者替换全局容器，插件可劫持 Kernel/EventBus/StateBus 等核心服务，破坏微内核稳定性与隔离。
- **Suggestion**: 仅在测试环境暴露（环境旗标/编译条件），或移除 setter 改为显式注入；可引入 capability token 或冻结容器以减少篡改面。
```
export function setGlobalContainer(container) {
  const root = /** @type {any} */ (globalThis);
  if (!container) {
    Reflect.deleteProperty(root, GLOBAL_CONTAINER_KEY);
    return;
  }
  root[GLOBAL_CONTAINER_KEY] = container;
}
```

---

## Archived: 2026-01-18

### [RESOLVED] jsdoc-type-mismatch
*Archived: 2026-01-18T21:13:18.830Z*

- **File**: js/agents/runtime/di/container.js:82
- **Description**: Container.get 与 ServiceEntry.factory 的 JSDoc 仅描述同步返回，但默认注册含 async 工厂，实际会返回 Promise，容易导致调用方遗漏 await。
- **Suggestion**: 将 factory/get/tryGet 的返回类型标注为 `*|Promise<*>`（或改为 async 接口），并在注释中明确异步工厂需要 await。
```
/**
 * Get a service instance.
 *
 * @param {string} id - Service identifier
 * @returns {*} Service instance
 * @throws {Error} If service is not registered
 */
```

### [RESOLVED] async-error-handling
*Archived: 2026-01-18T21:13:18.830Z*

- **File**: js/agents/runtime/di/container.js:115
- **Description**: tryGet 只捕获同步异常；当工厂返回 Promise 且 reject 时会产生未处理的 rejection，违背 tryGet 失败返回 undefined 的语义。
- **Suggestion**: 将 tryGet 改为 async 并 await/catch，或 `return Promise.resolve(this.get(id)).catch(() => undefined);`。
```
try {
  return this.has(id) ? this.get(id) : undefined;
} catch {
  return undefined;
}
```

### [RESOLVED] comment-scope-mismatch
*Archived: 2026-01-18T21:13:18.830Z*

- **File**: js/agents/runtime/di/defaults.js:370
- **Description**: Delta Sync 注释标为 TRANSIENT，但注册 scope 为 SINGLETON，生命周期语义不一致。
- **Suggestion**: 若需每次同步独立实例，改为 `{ scope: TRANSIENT }`；否则更新注释为 SINGLETON。
```
// P6.6: Delta Sync (TRANSIENT - 每次同步独立)
container.register(
  ServiceId.DELTA_SYNC,
  async () => {
    const { DeltaSyncSession } = await import("../../vfs/delta-sync.js");
    return { DeltaSyncSession }; // 返回类，由调用方实例化
  },
  { scope: SINGLETON }
);
```

### [RESOLVED] comment-scope-mismatch
*Archived: 2026-01-18T21:13:18.830Z*

- **File**: js/agents/runtime/di/defaults.js:429
- **Description**: VFS Proxy 注释标为 TRANSIENT，但注册 scope 为 SINGLETON，生命周期意图不一致。
- **Suggestion**: 对齐注释与 scope，明确是否需要每次调用创建新代理实例。
```
// P7.3: VFS Proxy (TRANSIENT - Worker 通信代理)
container.register(
  ServiceId.VFS_PROXY,
  async () => {
    const { VfsProxy } = await import("../core/vfs-proxy.js");
    return { VfsProxy }; // 返回类，由 Worker 场景实例化
  },
  { scope: SINGLETON }
);
```

---

