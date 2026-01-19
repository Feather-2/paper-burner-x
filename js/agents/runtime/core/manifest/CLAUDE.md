# manifest - 声明式清单

Skill/Tool/Stage/Middleware 的元数据声明、权限推断与校验。

## 模块描述

- 定义统一 ManifestSchema，支持 UI 发现、权限预审、运行时注册
- 提供 create*Manifest 工厂函数与参数 Schema 归一化（过滤危险键防原型污染）
- 提供 ManifestRegistry 完成注册、查询、导入/导出

## 核心文件

| 文件 | 职责 |
|------|------|
| `manifest.js` | 常量、工厂、校验、推断与 Registry |

## 关键概念

| 概念 | 说明 |
|------|------|
| `MANIFEST_VERSION` | Manifest 版本号 |
| `PermissionType` | 权限枚举 (read_file/write_file/execute/network/mcp/llm/user_input/memory) |
| `PluginType` | 插件类型 (tool/skill/stage/middleware) |
| `ManifestValidationError` | create*Manifest 缺少必填字段时抛出 |
| `ManifestSchema` | 清单结构 (manifestVersion/type/name/version/description/permissions/Schema/metadata/input/output/dependencies/config) |
| `validateManifest` | 校验清单并返回 errors 列表 |
| `extractManifestFromTool/Skill` | 从定义/元数据提取 Manifest 并推断权限（无输入返回 null） |
| `ManifestRegistry` | 注册、过滤、序列化清单 |

## 常见任务

### 创建 Tool Manifest

```javascript
import { createToolManifest, PermissionType } from 'js/agents/runtime/manifest';

const manifest = createToolManifest({
  name: 'read',
  description: '读取文件内容',
  parameters: { path: '必需：文件路径' },
  permissions: [PermissionType.READ_FILE],
});
```

### 创建 Skill Manifest

```javascript
import { createSkillManifest } from 'js/agents/runtime/manifest';

const manifest = createSkillManifest({
  name: 'doc-coauthoring',
  description: '文档协作流程',
  keywords: ['docs'],
  allowedTools: ['read', 'write'],
});
```

### 创建 Stage Manifest

```javascript
import { createStageManifest, PermissionType } from 'js/agents/runtime/manifest';

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
import { createMiddlewareManifest } from 'js/agents/runtime/manifest';

const manifest = createMiddlewareManifest({
  name: 'logging',
  description: '日志中间件',
  order: 10,
  phases: ['before', 'after'],
});
```

### 校验并注册

```javascript
import { ManifestRegistry, PluginType, validateManifest } from 'js/agents/runtime/manifest';

const registry = new ManifestRegistry();
const { valid, errors } = validateManifest(manifest);
if (!valid) throw new Error(errors.join(', '));

registry.register(manifest);
const tools = registry.getByType(PluginType.TOOL);
```

### 从定义提取 Manifest

```javascript
import { extractManifestFromTool, extractManifestFromSkill } from 'js/agents/runtime/manifest';

const toolManifest = extractManifestFromTool(toolDefinition);
const skillManifest = extractManifestFromSkill(skillMetadata);
```

definition/metadata 为空时会返回 null。

### 按权限过滤

```javascript
import { PermissionType } from 'js/agents/runtime/manifest';

const readable = registry.filterByPermission(PermissionType.READ_FILE);
```

### 导入/导出清单

```javascript
const json = registry.toJSON();
const restored = ManifestRegistry.fromJSON(json);
```
