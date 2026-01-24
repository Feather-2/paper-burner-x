# storage - 存储抽象

运行时数据持久化与归档。

## 核心文件

| 文件 | 职责 |
|------|------|
| `run-store.js` | RunStore - 运行记录/事件/附件持久化 |
| `run-store-cache.js` | RunStoreCache - RunStore 缓存封装（可选） |
| `run-exporter.js` | 运行数据导出/导入（zip，基于 JSZip） |
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
- `ARTIFACT_TYPE_ALIASES`：简写别名映射（例如 `deepsearch_state` -> `deepsearch_state.json`）
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

## 导出 / 导入（zip）

`run-exporter.js` 基于 JSZip 读写 zip：

- 浏览器：优先使用 `globalThis.JSZip`（例如通过 `<script>` 引入），否则会尝试动态 `import('jszip')`（需要 bundler 支持）。
- 导出：会对 zip 内文件名做安全归一化（仅保留 `a-zA-Z0-9._-`），并为缺少 `artifactId` 的条目生成稳定的 `artifacts/<type>_NNN` 路径。

```javascript
import { exportRunAsZip, importRunFromZip } from 'js/agents/storage/run-exporter.js';
import { RunStore } from 'js/agents/storage/run-store.js';

const store = new RunStore();

// 导出（返回 Blob/二进制数据，以实现为准）
const zipBlob = await exportRunAsZip('run_1', { runStore: store });

// 导入（参数以源码导出签名为准）
await importRunFromZip(zipBlob, { runStore: store });
```
