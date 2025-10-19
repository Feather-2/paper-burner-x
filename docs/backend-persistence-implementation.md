# 后端持久化实现指南

> 更新时间：2025-10-19
> 状态：已完成后端 API 实现，前端适配待集成

## ✅ 已完成工作

### 1. 数据库 Schema 扩展

已在 `server/prisma/schema.prisma` 中添加：

- **ChatMessage** - 聊天消息历史
- **Reference** - 文献引用数据
- **PromptPool** - 提示词池
- **UserSettings** 扩展字段:
  - `ocrConfig` (JSON) - OCR 配置
  - `academicSearchConfig` (JSON) - 学术搜索配置
  - `uiLayoutConfig` (JSON) - UI 布局配置

### 2. 数据库迁移文件

创建了 `server/prisma/migrations/002_add_chat_references_promptpool.sql`

手动执行迁移：
```bash
cd server
psql -U your_user -d paperburner -f prisma/migrations/002_add_chat_references_promptpool.sql
```

或者使用 Prisma：
```bash
cd server
npx prisma db push
```

### 3. 后端 API 路由

#### 聊天历史 API (`server/src/routes/chat.js`)
- `GET /api/chat/:documentId/history` - 获取聊天历史
- `POST /api/chat/:documentId/history` - 添加聊天消息
- `POST /api/chat/:documentId/history/batch` - 批量导入消息
- `DELETE /api/chat/:documentId/history` - 清空聊天历史

#### 文献引用 API (`server/src/routes/reference.js`)
- `GET /api/references/:documentId/references` - 获取所有引用
- `POST /api/references/:documentId/references` - 添加引用
- `POST /api/references/:documentId/references/batch` - 批量添加
- `PUT /api/references/:documentId/references/:refId` - 更新引用
- `DELETE /api/references/:documentId/references/:refId` - 删除引用

#### Prompt Pool API (`server/src/routes/prompt-pool.js`)
- `GET /api/prompt-pool` - 获取 Prompt Pool
- `PUT /api/prompt-pool` - 更新 Prompt Pool
- `POST /api/prompt-pool/prompts` - 添加单个 Prompt
- `DELETE /api/prompt-pool/prompts/:identifier` - 删除 Prompt

### 4. 前端 Storage Adapter 扩展

已在 `js/storage/storage-adapter.js` 的 `BackendStorage` 类中添加：

```javascript
// 聊天历史
await storageAdapter.loadChatHistory(docId)
await storageAdapter.saveChatMessage(docId, { role, content, metadata })
await storageAdapter.clearChatHistory(docId)

// 文献引用
await storageAdapter.loadReferences(docId)
await storageAdapter.saveReference(docId, reference)
await storageAdapter.deleteReference(docId, refId)

// Prompt Pool
await storageAdapter.loadPromptPool()
await storageAdapter.savePromptPool({ prompts, healthConfig })
```

---

## 🔧 待集成工作

### 1. 聊天历史管理器适配

**文件**: `js/chatbot/core/chat-history-manager.js`

**修改前**:
```javascript
saveHistory(docId, history) {
  localStorage.setItem('chatHistory_' + docId, JSON.stringify(history));
}

loadHistory(docId) {
  const raw = localStorage.getItem('chatHistory_' + docId);
  return raw ? JSON.parse(raw) : [];
}
```

**修改后**:
```javascript
async saveHistory(docId, history) {
  if (window.storageAdapter.isFrontendMode === false) {
    // 后端模式：批量保存
    try {
      // 清空旧历史
      await window.storageAdapter.clearChatHistory(docId);
      // 批量添加
      for (const msg of history) {
        await window.storageAdapter.saveChatMessage(docId, msg);
      }
    } catch (error) {
      console.error('Failed to save chat history to backend:', error);
    }
  } else {
    // 前端模式：localStorage
    localStorage.setItem('chatHistory_' + docId, JSON.stringify(history));
  }
}

async loadHistory(docId) {
  if (window.storageAdapter.isFrontendMode === false) {
    // 后端模式
    try {
      return await window.storageAdapter.loadChatHistory(docId);
    } catch (error) {
      console.error('Failed to load chat history from backend:', error);
      return [];
    }
  } else {
    // 前端模式
    const raw = localStorage.getItem('chatHistory_' + docId);
    return raw ? JSON.parse(raw) : [];
  }
}
```

### 2. 文献引用存储适配

**文件**: `js/storage/reference-storage.js`

**需要重构**: 将所有 `localStorage` 操作替换为 `storageAdapter` 调用

示例：
```javascript
async saveReference(docId, reference) {
  if (window.storageAdapter.isFrontendMode === false) {
    await window.storageAdapter.saveReference(docId, reference);
  } else {
    // 现有 localStorage 逻辑
    const key = `reference_metadata_${reference.id}`;
    localStorage.setItem(key, JSON.stringify(reference));
  }
}
```

### 3. Prompt Pool 适配

**文件**: `js/process/prompt-pool.js`

**修改**: `load()` 和 `save()` 方法

```javascript
async load() {
  if (window.storageAdapter.isFrontendMode === false) {
    const data = await window.storageAdapter.loadPromptPool();
    this.promptPool = data.prompts || [];
    this.healthConfig = data.healthConfig || this._getDefaultHealthConfig();
  } else {
    // 现有 localStorage 逻辑
    const stored = localStorage.getItem(this.storageKey);
    if (stored) {
      this.promptPool = JSON.parse(stored);
    }
  }
}

async save() {
  if (window.storageAdapter.isFrontendMode === false) {
    await window.storageAdapter.savePromptPool({
      prompts: this.promptPool,
      healthConfig: this.healthConfig
    });
  } else {
    localStorage.setItem(this.storageKey, JSON.stringify(this.promptPool));
  }
}
```

### 4. OCR 配置统一

**文件**: `js/process/ocr-manager.js`

**重构方向**: 将所有 OCR 配置读取从 localStorage 改为从 `settings.ocrConfig`

```javascript
async loadOCRConfig() {
  const settings = await window.storageAdapter.loadSettings();

  if (settings.ocrConfig) {
    return settings.ocrConfig;
  }

  // 降级：读取旧的 localStorage 配置
  return {
    engine: localStorage.getItem('ocrEngine') || 'mistral',
    minerU: {
      token: localStorage.getItem('ocrMinerUToken') || '',
      workerUrl: localStorage.getItem('ocrMinerUWorkerUrl') || '',
      // ...
    },
    // ...
  };
}

async saveOCRConfig(config) {
  const settings = await window.storageAdapter.loadSettings();
  settings.ocrConfig = config;
  await window.storageAdapter.saveSettings(settings);
}
```

### 5. UI 布局配置适配

**文件**:
- `js/ui/immersive_layout_logic.js`
- `js/ui/dock/dock_logic.js`
- `js/ui/dock/dock_settings_modal.js`

**重构方向**: 将 UI 状态保存到 `settings.uiLayoutConfig`

```javascript
async saveUILayout() {
  if (window.storageAdapter.isFrontendMode === false) {
    const settings = await window.storageAdapter.loadSettings();
    if (!settings.uiLayoutConfig) settings.uiLayoutConfig = {};

    settings.uiLayoutConfig.panelSizes = {
      toc: tocWidth,
      main: mainWidth,
      chatbot: chatbotWidth
    };

    await window.storageAdapter.saveSettings(settings);
  } else {
    localStorage.setItem(LS_PANEL_SIZES_KEY, JSON.stringify({ toc, main, chatbot }));
  }
}
```

---

## 🚀 部署步骤

### 1. 数据库迁移

```bash
cd server

# 方法1：使用 Prisma Migrate（推荐）
npx prisma db push

# 方法2：手动执行 SQL
psql -U your_user -d paperburner -f prisma/migrations/002_add_chat_references_promptpool.sql

# 生成 Prisma Client
npx prisma generate
```

### 2. 重启后端服务

```bash
cd server
npm run dev  # 开发环境
# 或
npm start    # 生产环境
```

### 3. 测试 API 端点

```bash
# 测试聊天历史
curl -X GET http://localhost:3000/api/chat/{docId}/history \
  -H "Authorization: Bearer {your_token}"

# 测试引用
curl -X GET http://localhost:3000/api/references/{docId}/references \
  -H "Authorization: Bearer {your_token}"

# 测试 Prompt Pool
curl -X GET http://localhost:3000/api/prompt-pool \
  -H "Authorization: Bearer {your_token}"
```

---

## 📝 数据迁移建议

### 从 localStorage 迁移到后端（可选）

为用户提供一次性导入功能：

**前端实现** (`js/storage/migration-helper.js`):
```javascript
async function migrateLocalDataToBackend() {
  if (window.storageAdapter.isFrontendMode !== false) {
    console.log('Not in backend mode, skip migration');
    return;
  }

  if (!confirm('检测到本地数据，是否导入到云端？')) return;

  try {
    // 1. 迁移聊天历史
    const chatHistoryKeys = Object.keys(localStorage).filter(k => k.startsWith('chatHistory_'));
    for (const key of chatHistoryKeys) {
      const docId = key.replace('chatHistory_', '');
      const history = JSON.parse(localStorage.getItem(key));

      for (const msg of history) {
        await window.storageAdapter.saveChatMessage(docId, msg);
      }
    }

    // 2. 迁移 Prompt Pool
    const promptPool = localStorage.getItem('promptPool');
    if (promptPool) {
      await window.storageAdapter.savePromptPool({
        prompts: JSON.parse(promptPool),
        healthConfig: null
      });
    }

    // 3. 迁移 OCR 配置
    const settings = await window.storageAdapter.loadSettings();
    settings.ocrConfig = {
      engine: localStorage.getItem('ocrEngine'),
      minerU: {
        token: localStorage.getItem('ocrMinerUToken'),
        // ...
      }
    };
    await window.storageAdapter.saveSettings(settings);

    alert('数据迁移完成！');
  } catch (error) {
    console.error('Migration failed:', error);
    alert('数据迁移失败：' + error.message);
  }
}

// 在登录后自动触发（仅首次）
if (localStorage.getItem('_migration_completed') !== 'true') {
  migrateLocalDataToBackend().then(() => {
    localStorage.setItem('_migration_completed', 'true');
  });
}
```

---

## 🔍 验证清单

- [ ] 数据库迁移成功，表已创建
- [ ] 后端服务正常启动，无报错
- [ ] 聊天历史 API 测试通过
- [ ] 文献引用 API 测试通过
- [ ] Prompt Pool API 测试通过
- [ ] 前端 storage-adapter 正确调用新 API
- [ ] 前端模式（file://）不受影响
- [ ] 后端模式数据正确持久化
- [ ] 数据迁移工具测试通过

---

## 📚 相关文档

- [后端持久化待办事项](./backend-persistence-todo.md)
- [Storage Adapter API 文档](../js/storage/storage-adapter.js)
- [Prisma Schema](../server/prisma/schema.prisma)
