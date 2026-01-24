# storage - 存储抽象

运行时数据持久化与归档。

## 核心文件

| 文件 | 职责 |
|------|------|
| `run-store.js` | RunStore - 运行记录/事件/附件持久化 |
| `run-store-cache.js` | RunStoreCache - RunStore 缓存封装（可选） |
| `run-exporter.js` | 运行数据导出/导入（zip） |
| `artifact-manager.js` | Artifact manifest/序列化/类型工具 |

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

## Artifact 管理

```javascript
import {
  createManifest,
  addArtifactToManifest,
  generateArtifactId,
} from 'js/agents/storage/artifact-manager.js';

const manifest = createManifest('run_1');
const artifactId = generateArtifactId('run_1', 'tool_output.json', 1);

addArtifactToManifest(manifest, {
  artifactId,
  type: 'tool_output.json',
  storageKey: 'runs/run_1/tool_output.json',
});
```

## Artifact 类型

`artifact-manager.js` 导出 `SUPPORTED_ARTIFACT_TYPES`（允许写入 manifest/导出/导入的类型）。建议在写入与导出前先做类型归一化与校验：

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

## 导出 / 导入

```javascript
import { exportRunAsZip, importRunFromZip } from 'js/agents/storage/run-exporter.js';
import { RunStore } from 'js/agents/storage/run-store.js';

const store = new RunStore();
const zipBlob = await exportRunAsZip('run_1', { runStore: store });

const importedRunId = await importRunFromZip(zipBlob, {
  runStore: store,
  overwrite: true,
});
```

导出/导入依赖 JSZip：优先使用 `globalThis.JSZip`，否则会动态 `import('jszip')`。在纯浏览器环境（无打包器）需要提前引入 JSZip，使 `globalThis.JSZip` 可用。

## RunStoreCache（可选）

`run-store-cache.js` 提供对 RunStore 的缓存封装，用于减少频繁读取带来的开销（缓存策略以实现为准）。

## storageAdapter 模式

storageAdapter 适用于 key/value 存储（saveTask/loadTask/saveState/loadState/saveArtifact/getArtifact 等）。依赖 runs/events 索引的接口需使用 IndexedDB。

```javascript
import { RunStore } from 'js/agents/storage/run-store.js';
import { createStorageAdapter } from 'js/agents/vfs/storage-adapter.js';

const storageAdapter = await createStorageAdapter();
const store = new RunStore({ storageAdapter });
```
