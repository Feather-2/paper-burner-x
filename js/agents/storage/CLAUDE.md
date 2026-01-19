# storage - 存储抽象

运行时数据持久化与归档。

## 核心文件

| 文件 | 职责 |
|------|------|
| `run-store.js` | RunStore - 运行记录/事件/附件持久化 |
| `run-exporter.js` | 运行数据导出/导入（zip） |
| `artifact-manager.js` | Artifact manifest/序列化工具 |

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
import { createManifest, addArtifactToManifest, generateArtifactId } from 'js/agents/storage/artifact-manager.js';

const manifest = createManifest('run_1');
const artifactId = generateArtifactId('run_1', 'tool_output.json', 1);

addArtifactToManifest(manifest, {
  artifactId,
  type: 'tool_output.json',
  storageKey: 'runs/run_1/tool_output.json',
});
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

## storageAdapter 模式

storageAdapter 适用于 key/value 存储（saveTask/loadTask/saveState/loadState/saveArtifact/getArtifact 等）。依赖 runs/events 索引的接口需使用 IndexedDB。

```javascript
import { RunStore } from 'js/agents/storage/run-store.js';
import { createStorageAdapter } from 'js/agents/vfs/storage-adapter.js';

const storageAdapter = await createStorageAdapter();
const store = new RunStore({ storageAdapter, prefix: 'deepsearch:run:' });

await store.saveTask({ taskId: 'task_1', status: 'queued' });
const task = await store.loadTask('task_1');
```
