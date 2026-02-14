# storage - 存储抽象

运行时数据持久化与归档（含导入/导出安全处理）。

## 核心文件

| 文件 | 职责 |
|------|------|
| `run-store.js` | RunStore - 运行记录/事件/附件持久化 |
| `run-store-cache.js` | RunStoreCache - RunStore 缓存封装（可选） |
| `run-exporter.js` | 运行数据导出/导入（zip，基于 JSZip；含 manifest 修复、类型白名单、安全文件名） |
| `artifact-manager.js` | Artifact manifest/序列化/类型工具（类型归一化、别名映射、ID/seq 管理） |

## RunStore

默认使用 IndexedDB（浏览器优先），可选传入 storageAdapter（key/value 后端）。IndexedDB 模式支持 runs/events/artifacts 的完整读写与清理。

```javascript
import { RunStore } from 'js/agents/storage/run-store.js';

const store = new RunStore();

// 创建运行并写入状态/事件
await store.createRun({ runId: 'run_1', startedAt: new Date().toISOString() });
await store.saveState('run_1', { status: 'running' });
await store.appendEvent('run_1', { eventId: 'evt_1', ts: Date.now(), name: 'agent:start' });

// 读取数据
const state = await store.loadState('run_1');
const events = await store.getEvents('run_1');
const artifacts = await store.listArtifactSummaries('run_1');
```

## 导出/导入约束

`run-exporter.js` 当前实现要点：

- `toSafeFileName(value)`：将 zip 条目名限制为 `[a-zA-Z0-9._-]`，避免非法路径字符
- `resolveZipPathForArtifact(item)`：统一落盘到 `artifacts/` 目录并做安全命名
- `ensureManifest(runStore, runId)`：导出前合并并修复 manifest，过滤为 `SUPPORTED_ARTIFACT_TYPES`
- `normalizeManifest(manifest, runId)`：校正 manifest 的 `runId` 一致性
- 优先复用 `globalThis.JSZip`，否则动态 `import('jszip')`，兼容 Browser/Node-like 环境

## Artifact 管理

`artifact-manager.js` 提供 manifest 结构、ID 生成与类型工具。建议在写入 manifest/导出/导入前先做类型归一化。

```javascript
import {
  createManifest,
  addArtifactToManifest,
  generateArtifactId,
  canonicalArtifactType,
} from 'js/agents/storage/artifact-manager.js';

const manifest = createManifest('run_1');
const artifactId = generateArtifactId('run_1', 'tool_output.json', 1);

addArtifactToManifest(manifest, {
  artifactId,
  type: canonicalArtifactType('tool_output.json'),
  storageKey: 'runs/run_1/tool_output.json',
});
```

## Artifact 类型

`artifact-manager.js` 导出：

- `SUPPORTED_ARTIFACT_TYPES`：允许写入 manifest/导出/导入的类型白名单
- `ARTIFACT_TYPE_ALIASES`：简写别名映射（如 `deepsearch_state` -> `deepsearch_state.json`）
- `canonicalArtifactType(type)`：将别名归一化为 canonical type

```javascript
import {
  canonicalArtifactType,
  SUPPORTED_ARTIFACT_TYPES,
} from 'js/agents/storage/artifact-manager.js';

const type = canonicalArtifactType('deepsearch_state'); // -> 'deepsearch_state.json'
if (!SUPPORTED_ARTIFACT_TYPES.includes(type)) {
  throw new Error(`Unsupported artifact type: ${type}`);
}
```

## 安全建议（模块内）

- 导入外部 zip/manifest 时，优先使用 `safeJsonParse(..., protoSafeReviver)` 做原型安全解析
- 对 `manifest.artifacts` 中的 `artifactId/type/storageKey` 做严格 schema 校验后再入库
- 在高并发导入导出场景下，建议为 manifest 更新增加版本号或 CAS 保护
