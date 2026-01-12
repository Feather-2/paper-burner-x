# 存储模块

Paper-Burner 的持久化层，基于适配器模式支持多种存储后端。

## 模块职责

- **抽象适配器**：统一存储接口
- **多后端支持**：LocalStorage / IndexedDB / Memory
- **仓库模式**：领域特定的存储逻辑
- **门面模式**：统一访问入口

## 架构

```
StorageFacade (门面)
    ├── SettingsRepository
    ├── ApiKeysRepository
    ├── ResultsRepository
    ├── ProcessedFilesRepository
    └── AnnotationsRepository
         ↓
    BaseRepository
         ↓
    BaseStorageAdapter
         ├── LocalStorageAdapter
         ├── IdbAdapter (IndexedDB)
         └── MemoryAdapter
```

## 公开 API

```javascript
import { storage } from 'js/storage';

// 仓库访问
storage.settings.get('theme');
storage.apiKeys.set('openai', 'sk-xxx');
storage.results.save(docId, result);
```

## 适配器

| 适配器 | 特点 | 适用场景 |
|--------|------|----------|
| LocalStorageAdapter | 同步、5MB 限制 | 小型配置 |
| IdbAdapter | 异步、大容量 | 文档/结果存储 |
| MemoryAdapter | 易失性 | 测试/临时数据 |

## 与 Agent 集成

- VFS 可使用 IdbAdapter 作为后端
- 结果存储用于历史记录
- 设置存储用于用户偏好

## 迁移

`./migrations/` 包含数据迁移脚本，版本升级时自动执行。
