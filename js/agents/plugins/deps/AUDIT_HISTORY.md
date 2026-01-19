# Audit History - deps

Archived issues from security audits.

---

## Archived: 2026-01-19

### [RESOLVED] test import path
*Archived: 2026-01-19T20:44:59.996Z*

- **File**: tests/unit/agents/runtime/deps/dependency-manager.test.js:12
- **Description**: 单元测试仍引用 js/agents/runtime/deps 路径，当前仓库中不存在该路径，测试可能无法运行导致覆盖率缺口。
- **Suggestion**: 更新测试导入为 js/agents/plugins/deps/... 或新增 runtime/deps 的 re-export 以保持兼容。
```
} from '../../../../../js/agents/runtime/deps/dependency-manager.js';
```

---

## Archived: 2026-01-19

### [RESOLVED] error handling
*Archived: 2026-01-19T20:44:56.399Z*

- **File**: js/agents/plugins/deps/dependency-manager.js:248
- **Description**: 存在空 catch 块吞掉异常（例如 _ensureCacheDir），与“不要吞掉异常”约定冲突。
- **Suggestion**: 至少记录 debug 级日志，或显式过滤已存在错误后再吞掉其他异常。
```
try {
  await this.vfs.mkdir(this.cacheDir, { recursive: true });
} catch {
  // 目录可能已存在
}
```

---

## Archived: 2026-01-19

### [RESOLVED] JSDoc any
*Archived: 2026-01-19T20:44:52.138Z*

- **File**: js/agents/plugins/deps/python-skill-executor.js:29
- **Description**: SkillExecutionResult 使用 {any}，违反“禁止 any 类型”约定，且降低结果类型可读性。
- **Suggestion**: 用更具体的类型或 {unknown} 并在调用处收窄，或根据 schema 定义 typedef。
```
* @property {any} [data] - 返回数据
```

---

## Archived: 2026-01-19

### [RESOLVED] invalid import
*Archived: 2026-01-19T20:44:48.342Z*

- **File**: js/agents/plugins/deps/python-skill-executor.js:12
- **Description**: 相对导入 ../core/python-adapter.js 在 plugins 目录下不存在，对应实现位于 runtime/core；打包时会解析失败。
- **Suggestion**: 修正到实际路径（如 ../../runtime/core/python-adapter.js）或在 plugins/core 提供转发模块。
```
import { PythonRuntimeAdapter } from "../core/python-adapter.js";
```

---

## Archived: 2026-01-19

### [RESOLVED] SSRF
*Archived: 2026-01-19T20:44:44.227Z*

- **File**: js/agents/plugins/deps/dependency-manager.js:204
- **Description**: cacheWheel 直接 fetch 用户可控的 wheel.url，仅限制 https，Node 环境可能被用于访问内网地址。
- **Suggestion**: 对允许的域名/前缀做白名单校验或强制使用可信仓库镜像；必要时在 Node 环境禁用外部 URL。
```
const urlObj = new URL(wheel.url);
...
const resp = await fetch(wheel.url);
```

---

## Archived: 2026-01-19

### [RESOLVED] resource leak
*Archived: 2026-01-19T20:44:18.956Z*

- **File**: js/agents/plugins/deps/python-skill-executor.js:185
- **Description**: executePythonSkill 创建新的 PythonSkillExecutor 后未终止 adapter，重复调用可能导致 worker/运行时泄漏。
- **Suggestion**: 一次性调用在 finally 中调用 executor.terminate()，或引入可复用的单例执行器。
```
const executor = new PythonSkillExecutor({
  vfs: context.vfs,
  ...options,
});

try {
  return await executor.execute(skill, context);
} finally {
  // 不终止适配器，允许复用
}
```

---

## Archived: 2026-01-19

### [RESOLVED] path traversal
*Archived: 2026-01-19T20:44:13.842Z*

- **File**: js/agents/plugins/deps/python-skill-executor.js:115
- **Description**: metadata.entrypoint 未校验直接拼接路径，允许通过 ../ 或绝对路径读取 VFS 内其他文件。
- **Suggestion**: 限制 entrypoint 只能是文件名（禁用 .. 和绝对路径），路径归一化后校验仍位于 skill 目录内。
```
const entrypoint = metadata.entrypoint || "main.py";
const skillPath = `${path}/${entrypoint}`;
```

---

