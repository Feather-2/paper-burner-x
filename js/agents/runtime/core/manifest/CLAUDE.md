# manifest - 声明式清单

Skill/Tool/Stage/Middleware 的元数据声明、权限推断与校验。

## 模块描述

- 定义统一 `ManifestSchema`，用于 UI 发现、权限预审、运行时注册
- 提供 `create*Manifest` 工厂函数与 Schema 归一化（过滤危险键，防原型污染）
- 提供 `ManifestRegistry` 完成注册、查询、导入/导出
- 导出 `PermissionType`/`PermissionValue` 与 `PluginType`/`PluginTypeValue` 作为统一枚举与类型

## 核心文件

| 文件 | 职责 |
|------|------|
| `manifest.js` | 常量、工厂、校验、推断与 Registry |

## 关键概念

| 概念 | 说明 |
|------|------|
| `MANIFEST_VERSION` | Manifest 版本号 |
| `PermissionType` | 权限枚举（read_file/write_file/execute/network/mcp/llm/user_input/memory） |
| `PermissionValue` | 权限值联合类型（由 `PermissionType` 派生） |
| `PluginType` | 插件类型枚举（tool/skill/stage/middleware） |
| `PluginTypeValue` | 插件类型值联合类型（由 `PluginType` 派生） |
| `ManifestValidationError` | 清单缺少必填字段或字段非法时抛出；可带 `field` 指示出错字段 |
| `ManifestSchema` | 清单结构（基础字段 + 各类型扩展字段） |
| `validateManifest` | 校验清单并返回 `errors` 列表 |
| `extractManifestFromTool/Skill` | 从 Tool/Skill 定义/元数据提取 Manifest 并推断权限（无元数据返回 `null`） |
| `ManifestRegistry` | 注册、查询、过滤与序列化清单 |

## 常见任务

### 创建 Tool Manifest

```javascript
import { createToolManifest, PermissionType } from 'js/agents/runtime/core/manifest/manifest.js';

const manifest = createToolManifest({
  name: 'read',
  description: '读取文件内容',
  parameters: { path: '必需：文件路径' },
  permissions: [PermissionType.READ_FILE],
});
```

### 创建 Skill Manifest

```javascript
import { createSkillManifest } from 'js/agents/runtime/core/manifest/manifest.js';

const manifest = createSkillManifest({
  name: 'doc-coauthoring',
  description: '文档协作流程',
  keywords: ['docs'],
  allowedTools: ['read', 'write'],
});
```

### 创建 Stage Manifest

```javascript
import { createStageManifest, PermissionType } from 'js/agents/runtime/core/manifest/manifest.js';

const manifest = createStageManifest({
  name: 'deepsearch',
  description: '深度搜索阶段',
  permissions: [PermissionType.NETWORK, PermissionType.LLM],
  dependencies: { 'mcp-client': '^1.0.0' },
  input: { type: 'object', properties: { query: { type: 'string' } } },
  output: { type: 'object', properties: { results: { type: 'array' } } },
});
```

### 创建 Middleware Manifest

```javascript
import { createMiddlewareManifest, PermissionType } from 'js/agents/runtime/core/manifest/manifest.js';

const manifest = createMiddlewareManifest({
  name: 'sanitize-input',
  description: '在执行前清理并校验输入',
  permissions: [PermissionType.USER_INPUT],
  metadata: { hooks: ['pre'] },
});
```
