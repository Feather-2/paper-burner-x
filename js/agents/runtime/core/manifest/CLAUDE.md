# manifest - 声明式清单

Skill/Tool/Stage/Middleware 的元数据声明、权限推断、作用域约束与校验。

## 模块描述

- 定义统一 `ManifestSchema`，用于 UI 发现、权限预审、运行时注册
- 导出 `MANIFEST_VERSION`、`PermissionType`/`PluginType` 及其值类型（`PermissionValue`/`PluginTypeValue`）
- 新增 `PermissionScope` 与 `ScopedPermission`，支持按目录、主机、命令、工具粒度限制权限
- `permissions` 字段支持 `PermissionValue` 与 `ScopedPermission` 混用
- 提供 `create*Manifest` 工厂函数与 Schema 归一化（过滤危险键，降低原型污染风险）
- 提供 `validateManifest` 进行结构校验；不合法时返回 `errors` 或抛出 `ManifestValidationError`
- 提供 `ManifestRegistry` 完成注册、查询、导入/导出清单

## 核心文件

| 文件 | 职责 |
|------|------|
| `manifest.js` | 常量、类型、工厂、权限推断、作用域校验与 Registry |

## 关键概念

| 概念 | 说明 |
|------|------|
| `MANIFEST_VERSION` | Manifest 版本号 |
| `PermissionType` | 权限枚举（`read_file`/`write_file`/`execute`/`network`/`mcp`/`llm`/`user_input`/`memory`） |
| `PermissionScope` | 权限作用域（`mounts`/`globs`/`allowHosts`/`denyPrivateIp`/`allowCommands`/`allowTools`） |
| `ScopedPermission` | 带作用域权限声明（`type` + 可选 `scope`） |
| `PermissionValue` | 权限值联合类型（由 `PermissionType` 派生） |
| `PluginType` | 插件类型枚举（`tool`/`skill`/`stage`/`middleware`） |
| `PluginTypeValue` | 插件类型值联合类型（由 `PluginType` 派生） |
| `ManifestValidationError` | 清单缺少必填字段或字段非法时抛出；可带 `field` 指示出错字段 |
| `validateManifest` | 校验清单并返回 `errors` 列表 |
| `extractManifestFromTool/Skill` | 从 Tool/Skill 定义提取 Manifest 并推断权限（无元数据返回 `null`） |
| `ManifestRegistry` | 注册、查询、过滤与序列化清单 |

## 常见任务

### 创建 Tool Manifest（含作用域权限）

```javascript
import { createToolManifest, PermissionType } from 'js/agents/runtime/core/manifest/manifest.js';

const manifest = createToolManifest({
  name: 'read',
  description: '读取受控目录中的文件',
  parameters: { path: '必需：文件路径' },
  permissions: [
    {
      type: PermissionType.READ_FILE,
      scope: {
        mounts: ['/workspace'],
        globs: ['**/*.md'],
      },
    },
  ],
});
```

### 创建 Skill Manifest

```javascript
import { createSkillManifest, PermissionType } from 'js/agents/runtime/core/manifest/manifest.js';

const manifest = createSkillManifest({
  name: 'doc-coauthoring',
  description: '文档协作流程',
  keywords: ['docs'],
  allowedTools: ['read', 'write'],
  permissions: [PermissionType.USER_INPUT],
});
```

### 创建 Stage Manifest

```javascript
import { createStageManifest, PermissionType } from 'js/agents/runtime/core/manifest/manifest.js';

const manifest = createStageManifest({
  name: 'deepsearch',
  description: '深度搜索阶段',
  permissions: [
    {
      type: PermissionType.NETWORK,
      scope: {
        allowHosts: ['api.openalex.org', 'api.crossref.org'],
        denyPrivateIp: true,
      },
    },
    PermissionType.LLM,
  ],
  dependencies: { mcpClient: '^1.0.0' },
});
```

### 校验并处理错误

```javascript
import {
  validateManifest,
  ManifestValidationError,
} from 'js/agents/runtime/core/manifest/manifest.js';

const result = validateManifest(manifest);
if (!result.valid) {
  const firstError = result.errors[0];
  throw new ManifestValidationError(firstError.message, firstError.field);
}
```

## 安全建议

- 高风险权限（`execute`/`network`/`mcp`/`write_file`）优先使用 `ScopedPermission`
- `network` 权限默认启用主机白名单与私网拦截
- 外部导入的 Manifest 先 `validateManifest`，再写入 `ManifestRegistry`
- UI 展示权限时区分无作用域权限与受限权限，避免误授权
