# Audit History - di

Archived issues from security audits.

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

