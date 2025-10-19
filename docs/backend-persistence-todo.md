# 后端持久化待办事项

> 生成时间：2025-10-19
> 目的：记录后端化过程中尚未完成的存储迁移任务

## 📊 完成度概览

- **已完成**: 70%
- **待完成**: 30%
- **影响**: 部分功能在后端模式下无法跨设备/会话同步

---

## ⚠️ 高优先级（影响核心功能）

### 1. 聊天历史记录 🔴

**当前状态**:
- **存储方式**: localStorage (`chatHistory_{docId}`)
- **位置**: [js/chatbot/core/chat-history-manager.js:17,31,71](../js/chatbot/core/chat-history-manager.js)
- **问题**: 多设备/会话间不同步，刷新可能丢失

**需要实现**:
- [ ] 后端 API: `GET /api/documents/:id/chat-history`
- [ ] 后端 API: `POST /api/documents/:id/chat-history`
- [ ] 后端 API: `DELETE /api/documents/:id/chat-history`
- [ ] 数据库表结构（建议）:
  ```sql
  CREATE TABLE chat_messages (
    id UUID PRIMARY KEY,
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL, -- 'user' | 'assistant'
    content TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT NOW(),
    metadata JSONB -- 扩展字段（模型、token 消耗等）
  );
  CREATE INDEX idx_chat_messages_document ON chat_messages(document_id, timestamp);
  ```
- [ ] 修改 `chat-history-manager.js` 使用 `storageAdapter`

**预估工作量**: 4-6 小时

---

### 2. 文献引用数据 🔴

**当前状态**:
- **存储方式**: localStorage (多个 key)
- **位置**: [js/storage/reference-storage.js:24,50,75,108,128](../js/storage/reference-storage.js)
- **数据类型**:
  - 引用元数据索引 (`reference_metadata_index`)
  - 详细引用数据 (`reference_metadata_{id}`)
- **问题**: 跨页面引用管理失效，引用库不持久化

**需要实现**:
- [ ] 后端 API: `GET /api/documents/:id/references`
- [ ] 后端 API: `POST /api/documents/:id/references`
- [ ] 后端 API: `PUT /api/documents/:id/references/:refId`
- [ ] 后端 API: `DELETE /api/documents/:id/references/:refId`
- [ ] 数据库表结构（建议）:
  ```sql
  CREATE TABLE references (
    id UUID PRIMARY KEY,
    document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    citation_key TEXT NOT NULL, -- 引用标识符（如 [1]）
    doi TEXT,
    title TEXT,
    authors JSONB, -- [{name, affiliation}]
    year INTEGER,
    journal TEXT,
    volume TEXT,
    pages TEXT,
    url TEXT,
    metadata JSONB, -- 完整元数据
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(document_id, citation_key)
  );
  CREATE INDEX idx_references_document ON references(document_id);
  ```
- [ ] 修改 `reference-storage.js` 使用 `storageAdapter`

**预估工作量**: 6-8 小时

---

### 3. OCR 配置统一 🟠

**当前状态**:
- **存储方式**: localStorage (多个分散的 key)
- **位置**: [js/process/ocr-manager.js:36-103](../js/process/ocr-manager.js)
- **数据类型**:
  - `ocrEngine` - OCR 引擎选择
  - `ocrMistralKeys` - Mistral OCR Keys（已有后端但前端仍读 localStorage）
  - `ocrMinerUToken`, `ocrDoc2XToken` - Token
  - `ocrWorkerAuthKey`, `ocrMinerUWorkerUrl` 等
- **问题**: 配置分散，部分已有后端存储但未完全迁移

**需要实现**:
- [ ] 扩展 `/api/user/settings` 添加 OCR 配置字段:
  ```json
  {
    "ocrEngine": "mistral|mineru|doc2x",
    "ocrMinerU": {
      "token": "...",
      "workerUrl": "...",
      "authKey": "...",
      "tokenMode": "frontend|backend",
      "enableOcr": true,
      "enableFormula": true,
      "enableTable": true
    },
    "ocrDoc2X": {
      "token": "...",
      "workerUrl": "...",
      "authKey": "...",
      "tokenMode": "frontend|backend"
    }
  }
  ```
- [ ] 修改 `ocr-manager.js` 从 `storageAdapter.loadSettings()` 读取
- [ ] 迁移现有 localStorage 数据到 settings（可选，一次性脚本）

**预估工作量**: 2-3 小时

---

## 🟡 中优先级（提升用户体验）

### 4. Prompt Pool（提示词池） 🟡

**当前状态**:
- **存储方式**: localStorage
- **位置**:
  - [js/process/prompt-pool.js:28,56,79,112,129](../js/process/prompt-pool.js)
  - [js/ui/prompt-pool-ui.js:36,140,350](../js/ui/prompt-pool-ui.js)
- **数据类型**: 用户自定义提示词模板
- **问题**: 不同设备间提示词不同步

**需要实现**:
- [ ] 后端 API: `GET /api/user/prompt-pool`
- [ ] 后端 API: `PUT /api/user/prompt-pool` (全量更新)
- [ ] 后端 API: `POST /api/user/prompt-pool/prompts` (添加单条)
- [ ] 后端 API: `DELETE /api/user/prompt-pool/prompts/:id`
- [ ] 数据库表结构（建议）:
  ```sql
  CREATE TABLE prompt_pool (
    id UUID PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    prompts JSONB NOT NULL, -- 提示词数组
    health_config JSONB, -- 健康检查配置
    updated_at TIMESTAMP DEFAULT NOW()
  );
  ```
- [ ] 修改 `prompt-pool.js` 和 `prompt-pool-ui.js` 使用 `storageAdapter`

**预估工作量**: 3-4 小时

---

### 5. 学术搜索配置 🟡

**当前状态**:
- **存储方式**: localStorage
- **位置**: [js/processing/reference-doi-resolver.js:12,81](../js/processing/reference-doi-resolver.js)
- **数据类型**:
  - `academicSearchProxyConfig` - 代理配置
  - `academicSearchSourcesConfig` - 数据源配置
- **问题**: 跨设备配置不一致

**需要实现**:
- [ ] 扩展 `/api/user/settings` 添加学术搜索字段:
  ```json
  {
    "academicSearch": {
      "proxyConfig": {
        "enabled": true,
        "url": "https://..."
      },
      "sourcesConfig": {
        "preferredSources": ["crossref", "semantic_scholar"],
        "timeout": 5000
      }
    }
  }
  ```
- [ ] 修改 `reference-doi-resolver.js` 从 `storageAdapter.loadSettings()` 读取

**预估工作量**: 1-2 小时

---

## 🟢 低优先级（不影响核心功能）

### 6. UI 布局状态 🟢

**当前状态**:
- **存储方式**: localStorage (多个 key)
- **位置**:
  - [js/ui/immersive_layout_logic.js:85,91,301,423,506,536,658,663](../js/ui/immersive_layout_logic.js)
  - [js/ui/dock/dock_logic.js:397,414,418,472,474,481,484](../js/ui/dock/dock_logic.js)
  - [js/ui/dock/dock_settings_modal.js:103,130](../js/ui/dock/dock_settings_modal.js)
- **数据类型**:
  - 面板尺寸配置 (`LS_PANEL_SIZES_KEY`)
  - 沉浸式模式状态 (`LS_IMMERSIVE_KEY`)
  - Dock 折叠状态 (`dockCollapsed_{docId}`)
  - TOC 模式 (`tocMode_{docId}`)
- **问题**: 用户界面偏好不同步

**需要实现**:
- [ ] 扩展 `/api/user/settings` 添加 UI 布局字段:
  ```json
  {
    "uiLayout": {
      "panelSizes": {
        "toc": 300,
        "main": 800,
        "chatbot": 400
      },
      "immersiveMode": false,
      "dockCollapsed": {
        "global": false,
        "perDocument": {
          "doc-id-1": true
        }
      },
      "tocMode": {
        "perDocument": {
          "doc-id-1": "enhanced"
        }
      },
      "dockDisplayConfig": {
        "global": {},
        "perDocument": {}
      }
    }
  }
  ```
- [ ] 修改相关 UI 逻辑文件使用 `storageAdapter`

**预估工作量**: 3-4 小时

---

## 📋 数据库 Schema 补充（Prisma）

需要在 `server/prisma/schema.prisma` 中添加以下模型：

```prisma
// 聊天消息
model ChatMessage {
  id          String    @id @default(uuid())
  documentId  String    @map("document_id")
  userId      String    @map("user_id")
  role        String    // 'user' | 'assistant'
  content     String    @db.Text
  timestamp   DateTime  @default(now())
  metadata    Json?     // 模型、token 等扩展信息

  document    Document  @relation(fields: [documentId], references: [id], onDelete: Cascade)
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([documentId, timestamp])
  @@map("chat_messages")
}

// 文献引用
model Reference {
  id           String    @id @default(uuid())
  documentId   String    @map("document_id")
  userId       String    @map("user_id")
  citationKey  String    @map("citation_key") // 如 "[1]"
  doi          String?
  title        String?
  authors      Json?     // [{name, affiliation}]
  year         Int?
  journal      String?
  volume       String?
  pages        String?
  url          String?
  metadata     Json?     // 完整元数据
  createdAt    DateTime  @default(now()) @map("created_at")

  document     Document  @relation(fields: [documentId], references: [id], onDelete: Cascade)
  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([documentId, citationKey])
  @@index([documentId])
  @@map("references")
}

// 提示词池
model PromptPool {
  id           String    @id @default(uuid())
  userId       String    @unique @map("user_id")
  prompts      Json      // 提示词数组
  healthConfig Json?     @map("health_config")
  updatedAt    DateTime  @default(now()) @updatedAt @map("updated_at")

  user         User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("prompt_pool")
}
```

同时需要更新 `UserSettings` 模型添加新字段：

```prisma
model UserSettings {
  // ... 现有字段 ...

  // OCR 配置
  ocrConfig              Json?     @map("ocr_config")

  // 学术搜索配置
  academicSearchConfig   Json?     @map("academic_search_config")

  // UI 布局配置
  uiLayoutConfig         Json?     @map("ui_layout_config")
}
```

---

## 🚀 实施计划

### 第一阶段（核心功能）- 预估 12-17 小时
1. 聊天历史记录 API + 数据库迁移
2. 文献引用数据 API + 数据库迁移
3. OCR 配置统一

### 第二阶段（用户体验优化）- 预估 4-6 小时
4. Prompt Pool API
5. 学术搜索配置扩展

### 第三阶段（可选）- 预估 3-4 小时
6. UI 布局状态同步

---

## 📝 注意事项

1. **数据迁移策略**:
   - 后端模式：首次登录时提示用户导入现有 localStorage 数据
   - 前端模式：继续使用 localStorage，不受影响

2. **向后兼容**:
   - 所有修改需保证前端模式（Vercel/静态）正常工作
   - storage-adapter 已实现自动降级，新 API 需遵循相同模式

3. **性能优化**:
   - 聊天历史和引用数据可考虑分页加载
   - 使用 `updatedAt` 字段实现增量同步

4. **测试重点**:
   - 前端模式 (file://) 不受影响
   - 后端模式数据正确持久化
   - 模式切换时数据不丢失
