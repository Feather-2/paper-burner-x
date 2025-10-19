# Paper Burner X - 后端改进文档

## 📋 改进概览

本次改进针对 Paper Burner X 的持久化和多用户功能进行了全面升级，实现了以下关键改进：

### ✅ 已完成的改进

#### 1. API Keys 加密存储 (P0 - 关键)

**实现文件:**
- [server/src/utils/crypto.js](server/src/utils/crypto.js) - 加密工具模块
- [server/src/routes/user.js](server/src/routes/user.js) - 更新的 API Keys 路由

**功能特性:**
- ✅ 使用 AES-256-GCM 加密算法
- ✅ 自动加密所有新添加的 API Keys
- ✅ 提供解密接口（仅内部使用）
- ✅ 支持密钥状态管理 (VALID/INVALID/TESTING/UNTESTED)

**API 端点:**
```
GET    /api/user/api-keys              # 获取 API Keys 列表（不含明文）
POST   /api/user/api-keys              # 添加 API Key（自动加密）
GET    /api/user/api-keys/:id/decrypt  # 解密 API Key（内部使用）
PATCH  /api/user/api-keys/:id/status   # 更新 Key 状态
DELETE /api/user/api-keys/:id          # 删除 API Key
```

**环境变量配置:**
```bash
# .env
ENCRYPTION_SECRET=your-encryption-secret-change-in-production-min-32-chars
```

---

#### 2. 意群数据后端 API (P1 - 重要)

**实现文件:**
- [server/src/routes/document.js](server/src/routes/document.js) - 文档路由扩展

**功能特性:**
- ✅ 完整的意群数据 CRUD 操作
- ✅ 数据按用户隔离
- ✅ 支持版本控制
- ✅ 文档所有权验证

**API 端点:**
```
POST   /api/documents/:id/semantic-groups  # 保存/更新意群数据
GET    /api/documents/:id/semantic-groups  # 获取意群数据
```

**数据结构:**
```json
{
  "groups": [...],      // 意群数组
  "version": "1.0",     // 版本号
  "source": "auto"      // 数据来源
}
```

---

#### 3. 标注数据增强 API (P1 - 重要)

**功能特性:**
- ✅ 创建标注
- ✅ 更新标注
- ✅ 删除标注
- ✅ 查询文档的所有标注

**API 端点:**
```
GET    /api/documents/:id/annotations                      # 获取文档标注
POST   /api/documents/:id/annotations                      # 创建标注
PUT    /api/documents/:docId/annotations/:annotationId    # 更新标注
DELETE /api/documents/:docId/annotations/:annotationId    # 删除标注
```

---

#### 4. 已处理文件记录同步 (P1 - 重要)

**实现文件:**
- [server/prisma/schema.prisma](server/prisma/schema.prisma) - ProcessedFile 模型
- [server/src/routes/user.js](server/src/routes/user.js) - 已处理文件路由

**功能特性:**
- ✅ 后端持久化已处理文件记录
- ✅ 支持批量检查
- ✅ 按用户隔离数据
- ✅ 唯一性约束（用户+文件标识符）

**API 端点:**
```
GET    /api/user/processed-files                    # 获取已处理文件列表
POST   /api/user/processed-files                    # 标记文件为已处理
GET    /api/user/processed-files/check/:identifier  # 检查单个文件
POST   /api/user/processed-files/check-batch        # 批量检查
DELETE /api/user/processed-files                    # 清空记录
```

**使用示例:**
```javascript
// 标记文件为已处理
const fileIdentifier = `${file.name}_${file.size}_${file.lastModified}`;
await fetch('/api/user/processed-files', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    fileIdentifier,
    fileName: file.name
  })
});

// 批量检查
const response = await fetch('/api/user/processed-files/check-batch', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    identifiers: ['file1_id', 'file2_id']
  })
});
// 返回: { "file1_id": true, "file2_id": false }
```

---

#### 5. 用户配额管理系统 (P2 - 优化)

**实现文件:**
- [server/prisma/schema.prisma](server/prisma/schema.prisma) - UserQuota 和 UsageLog 模型
- [server/src/utils/quota.js](server/src/utils/quota.js) - 配额工具函数
- [server/src/routes/admin.js](server/src/routes/admin.js) - 管理员配额管理
- [server/src/routes/document.js](server/src/routes/document.js) - 集成配额检查

**功能特性:**
- ✅ 每日/每月文档数量限制
- ✅ 存储空间限制
- ✅ API Keys 数量限制
- ✅ 自动月度重置
- ✅ 使用量实时跟踪
- ✅ 创建文档时自动检查配额

**配额字段:**
```javascript
{
  maxDocumentsPerDay: -1,      // -1 = 无限制
  maxDocumentsPerMonth: -1,
  maxStorageSize: -1,          // MB
  maxApiKeysCount: -1,
  documentsThisMonth: 0,       // 当前使用量
  currentStorageUsed: 0,       // MB
  lastMonthlyReset: Date       // 上次重置时间
}
```

**管理员 API:**
```
GET  /api/admin/users/:userId/quota   # 获取用户配额
PUT  /api/admin/users/:userId/quota   # 更新用户配额
```

**工具函数:**
```javascript
import { checkQuota, incrementDocumentCount, logUsage } from '../utils/quota.js';

// 检查配额
const quotaCheck = await checkQuota(userId);
if (!quotaCheck.allowed) {
  return res.status(403).json({ error: quotaCheck.reason });
}

// 增加文档计数
await incrementDocumentCount(userId, fileSize);

// 记录使用日志
await logUsage(userId, 'document_create', documentId, metadata);
```

---

#### 6. 高级统计和分析 (P2 - 优化)

**实现文件:**
- [server/src/routes/admin.js](server/src/routes/admin.js) - 统计路由

**功能特性:**
- ✅ 详细的系统统计
- ✅ 使用趋势分析
- ✅ 按状态分组统计
- ✅ 最活跃用户排行
- ✅ 用户活动日志

**API 端点:**
```
GET /api/admin/stats/detailed          # 详细统计
GET /api/admin/stats/trends?days=30    # 使用趋势
GET /api/admin/users/:userId/activity  # 用户活动日志
```

**详细统计响应示例:**
```json
{
  "basic": {
    "totalUsers": 150,
    "activeUsers": 120,
    "totalDocuments": 5432,
    "totalStorageMB": 2048,
    "documentsToday": 45,
    "documentsThisWeek": 234,
    "documentsThisMonth": 987
  },
  "documentsByStatus": [
    { "status": "COMPLETED", "count": 4500 },
    { "status": "FAILED", "count": 100 },
    { "status": "PROCESSING", "count": 832 }
  ],
  "topUsers": [
    {
      "id": "user-id",
      "email": "user@example.com",
      "name": "User Name",
      "documentCount": 234
    }
  ]
}
```

**趋势分析响应示例:**
```json
[
  {
    "date": "2025-01-01",
    "total": 150,
    "completed": 140,
    "failed": 10
  },
  {
    "date": "2025-01-02",
    "total": 180,
    "completed": 170,
    "failed": 10
  }
]
```

---

## 🗄️ 数据库 Schema 变更

### 新增表

#### 1. processed_files - 已处理文件记录
```sql
CREATE TABLE "processed_files" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "fileIdentifier" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "processedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE("userId", "fileIdentifier")
);
```

#### 2. user_quotas - 用户配额
```sql
CREATE TABLE "user_quotas" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT UNIQUE NOT NULL,
  "maxDocumentsPerDay" INTEGER DEFAULT -1,
  "maxDocumentsPerMonth" INTEGER DEFAULT -1,
  "maxStorageSize" INTEGER DEFAULT -1,
  "maxApiKeysCount" INTEGER DEFAULT -1,
  "documentsThisMonth" INTEGER DEFAULT 0,
  "currentStorageUsed" INTEGER DEFAULT 0,
  "lastMonthlyReset" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ...
);
```

#### 3. usage_logs - 使用量日志
```sql
CREATE TABLE "usage_logs" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "resourceId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

---

## 🚀 部署指南

### 1. 数据库迁移

```bash
# 进入 server 目录
cd server

# 生成 Prisma Client
npx prisma generate

# 运行迁移
npx prisma migrate deploy
```

### 2. 环境变量配置

更新 `.env` 文件：

```bash
# 必需：加密密钥
ENCRYPTION_SECRET=<生成一个32字符以上的随机字符串>

# 可选：配额限制（默认无限制）
DEFAULT_MONTHLY_DOCUMENT_LIMIT=-1
DEFAULT_STORAGE_LIMIT_MB=-1
```

### 3. Docker 部署

如果使用 Docker，确保 `docker-compose.yml` 包含环境变量：

```yaml
environment:
  ENCRYPTION_SECRET: ${ENCRYPTION_SECRET}
```

### 4. 重启服务

```bash
# Docker
docker-compose down
docker-compose up -d

# 或直接重启
npm run start
```

---

## 📝 前端集成指南

### 1. API Keys 管理

**迁移本地存储到后端:**

```javascript
// 旧代码（localStorage）
localStorage.setItem('apiKeys', JSON.stringify(keys));

// 新代码（后端 API）
async function saveApiKey(provider, keyValue, remark) {
  const response = await fetch('/api/user/api-keys', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ provider, keyValue, remark })
  });
  return response.json();
}

// 获取 Keys（不含明文）
async function getApiKeys() {
  const response = await fetch('/api/user/api-keys', {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return response.json();
}
```

### 2. 意群数据同步

**将 IndexedDB 迁移到后端:**

```javascript
// 旧代码（IndexedDB）
await saveSemanticGroupsToDB(documentId, groups);

// 新代码（后端 API）
async function saveSemanticGroups(documentId, groups, version, source) {
  const response = await fetch(`/api/documents/${documentId}/semantic-groups`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ groups, version, source })
  });
  return response.json();
}

// 获取意群数据
async function getSemanticGroups(documentId) {
  const response = await fetch(`/api/documents/${documentId}/semantic-groups`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return response.json();
}
```

### 3. 标注功能集成

```javascript
// 创建标注
async function createAnnotation(documentId, annotationData) {
  const response = await fetch(`/api/documents/${documentId}/annotations`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(annotationData)
  });
  return response.json();
}

// 更新标注
async function updateAnnotation(documentId, annotationId, updates) {
  const response = await fetch(
    `/api/documents/${documentId}/annotations/${annotationId}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updates)
    }
  );
  return response.json();
}
```

### 4. 已处理文件检查

```javascript
// 批处理前检查文件
async function filterUnprocessedFiles(files) {
  const identifiers = files.map(f =>
    `${f.name}_${f.size}_${f.lastModified}`
  );

  const response = await fetch('/api/user/processed-files/check-batch', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ identifiers })
  });

  const processedMap = await response.json();

  return files.filter((f, i) => !processedMap[identifiers[i]]);
}

// 处理完成后标记
async function markFileAsProcessed(file) {
  const fileIdentifier = `${file.name}_${file.size}_${file.lastModified}`;

  await fetch('/api/user/processed-files', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      fileIdentifier,
      fileName: file.name
    })
  });
}
```

---

## 🔐 安全性改进

### 1. API Keys 加密

- **算法**: AES-256-GCM (认证加密)
- **密钥派生**: PBKDF2 (100,000 迭代)
- **IV**: 随机生成，16 字节
- **认证标签**: 16 字节，防止篡改

### 2. 数据隔离

所有用户数据都有严格的 `userId` 过滤：

```javascript
// 示例：只能访问自己的文档
await prisma.document.findMany({
  where: {
    id: req.params.id,
    userId: req.user.id  // 强制用户隔离
  }
});
```

### 3. 输入验证

所有 API 端点都包含输入验证：

```javascript
if (!provider || !keyValue) {
  return res.status(400).json({
    error: 'Provider and keyValue are required'
  });
}
```

---

## 📊 管理员面板增强

### 新增功能

1. **详细统计仪表盘**
   - 总用户数、活跃用户数
   - 文档总数及按时间段统计
   - 存储使用情况
   - 按状态分类统计

2. **用户配额管理**
   - 为单个用户设置配额
   - 查看当前使用量
   - 手动重置配额

3. **使用趋势图表**
   - 过去 N 天的文档创建趋势
   - 成功/失败率统计

4. **用户活动日志**
   - 查看用户操作历史
   - 审计和问题排查

---

## ⚠️ 注意事项

### 1. 现有 API Keys 迁移

现有的未加密 API Keys 需要迁移：

```javascript
// 迁移脚本（运行一次）
async function migrateExistingKeys() {
  const keys = await prisma.apiKey.findMany();

  for (const key of keys) {
    // 如果 key 看起来未加密（简单检查）
    if (!key.keyValue.includes('==')) {
      const encrypted = encrypt(key.keyValue);
      await prisma.apiKey.update({
        where: { id: key.id },
        data: { keyValue: encrypted }
      });
    }
  }
}
```

### 2. 前端逐步迁移

建议分阶段迁移前端功能：

- **阶段 1**: 新用户使用后端 API
- **阶段 2**: 现有用户数据双写（本地 + 后端）
- **阶段 3**: 完全迁移到后端，移除本地存储

### 3. 性能考虑

- 批量操作时使用批量 API（如 `check-batch`）
- 合理设置查询 limit 和 offset
- 使用索引加速查询

---

## 🧪 测试建议

### 1. API Keys 加密测试

```bash
# 添加 API Key
curl -X POST http://localhost:3000/api/user/api-keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"deepseek","keyValue":"sk-test-key","remark":"测试"}'

# 验证数据库中已加密
psql -d paperburner -c "SELECT keyValue FROM api_keys LIMIT 1;"
# 应该看到 Base64 编码的密文，而非明文
```

### 2. 配额限制测试

```bash
# 设置配额
curl -X PUT http://localhost:3000/api/admin/users/$USER_ID/quota \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"maxDocumentsPerMonth":5}'

# 尝试超出配额创建文档
# 应该返回 403 错误
```

### 3. 数据隔离测试

```bash
# 用户 A 创建文档
curl -X POST http://localhost:3000/api/documents \
  -H "Authorization: Bearer $TOKEN_A" \
  -d '...'

# 用户 B 尝试访问用户 A 的文档
curl http://localhost:3000/api/documents/$DOC_ID_A \
  -H "Authorization: Bearer $TOKEN_B"
# 应该返回 404 Not Found
```

---

## 📚 相关文件索引

### 核心实现
- `server/src/utils/crypto.js` - 加密工具
- `server/src/utils/quota.js` - 配额管理
- `server/src/routes/user.js` - 用户路由（API Keys、已处理文件）
- `server/src/routes/document.js` - 文档路由（意群、标注、配额检查）
- `server/src/routes/admin.js` - 管理员路由（统计、配额）

### 数据库
- `server/prisma/schema.prisma` - 完整 Schema
- `server/prisma/migrations/002_add_processed_files_and_quotas/migration.sql` - 新表迁移

### 配置
- `.env.example` - 环境变量模板
- `docker-compose.yml` - Docker 配置

---

## 🎯 下一步建议

### 短期（1-2周）

1. **前端集成**
   - 修改前端调用新的后端 API
   - 实现数据迁移工具（localStorage -> 后端）
   - 更新 UI 显示配额信息

2. **管理员界面增强**
   - 添加配额管理页面
   - 实现趋势图表可视化
   - 用户活动日志查看器

### 中期（1-2月）

1. **历史记录完全迁移**
   - 将完整的文档处理结果存储到后端
   - 实现跨设备同步
   - 提供导入/导出功能

2. **性能优化**
   - 添加 Redis 缓存
   - 实现分页加载
   - 优化大文件处理

### 长期（3-6月）

1. **高级功能**
   - 团队协作功能
   - 文档共享
   - API 限流和防滥用
   - 多语言支持

2. **监控和告警**
   - Prometheus 指标
   - 告警系统
   - 性能监控

---

## 📞 支持

如有问题，请查看：
- GitHub Issues
- 项目文档
- API 文档（Swagger/OpenAPI）

---

**最后更新**: 2025-01-17
**版本**: 2.0.0
