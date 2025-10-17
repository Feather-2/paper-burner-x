# Paper Burner X - API 参考文档

## 认证

所有需要认证的端点都需要在请求头中包含 JWT Token：

```
Authorization: Bearer <token>
```

## 用户相关 API

### 用户设置

#### 获取用户设置
```
GET /api/user/settings
```

#### 更新用户设置
```
PUT /api/user/settings
Content-Type: application/json

{
  "ocrProvider": "mineru",
  "translationModel": "deepseek",
  "targetLanguage": "chinese",
  ...
}
```

---

### API Keys 管理

#### 获取 API Keys 列表
```
GET /api/user/api-keys

Response:
[
  {
    "id": "uuid",
    "provider": "deepseek",
    "remark": "主要密钥",
    "status": "VALID",
    "order": 0,
    "lastUsedAt": "2025-01-17T...",
    "createdAt": "2025-01-01T..."
  }
]
```

#### 添加 API Key
```
POST /api/user/api-keys
Content-Type: application/json

{
  "provider": "deepseek",
  "keyValue": "sk-...",
  "remark": "备用密钥",
  "order": 1
}

Response:
{
  "id": "uuid",
  "provider": "deepseek",
  "remark": "备用密钥",
  "status": "UNTESTED",
  "order": 1
}
```

#### 更新 API Key 状态
```
PATCH /api/user/api-keys/:id/status
Content-Type: application/json

{
  "status": "VALID"
}
```

#### 删除 API Key
```
DELETE /api/user/api-keys/:id
```

---

### 术语库管理

#### 获取术语库列表
```
GET /api/user/glossaries
```

#### 创建术语库
```
POST /api/user/glossaries
Content-Type: application/json

{
  "name": "医学术语",
  "enabled": true,
  "entries": [
    {"source": "protein", "target": "蛋白质"},
    {"source": "cell", "target": "细胞"}
  ]
}
```

#### 更新术语库
```
PUT /api/user/glossaries/:id
```

#### 删除术语库
```
DELETE /api/user/glossaries/:id
```

---

### 已处理文件记录

#### 获取已处理文件列表
```
GET /api/user/processed-files

Response:
[
  {
    "fileIdentifier": "paper.pdf_1024000_1705478400000",
    "fileName": "paper.pdf",
    "processedAt": "2025-01-17T..."
  }
]
```

#### 标记文件为已处理
```
POST /api/user/processed-files
Content-Type: application/json

{
  "fileIdentifier": "paper.pdf_1024000_1705478400000",
  "fileName": "paper.pdf"
}
```

#### 检查单个文件是否已处理
```
GET /api/user/processed-files/check/:identifier

Response:
{
  "processed": true
}
```

#### 批量检查文件是否已处理
```
POST /api/user/processed-files/check-batch
Content-Type: application/json

{
  "identifiers": [
    "file1_id",
    "file2_id",
    "file3_id"
  ]
}

Response:
{
  "file1_id": true,
  "file2_id": false,
  "file3_id": true
}
```

#### 清空已处理文件记录
```
DELETE /api/user/processed-files
```

---

## 文档管理 API

### 文档 CRUD

#### 获取文档列表
```
GET /api/documents?page=1&limit=20&status=COMPLETED

Response:
{
  "documents": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

#### 获取文档详情
```
GET /api/documents/:id

Response:
{
  "id": "uuid",
  "fileName": "paper.pdf",
  "fileType": "pdf",
  "status": "COMPLETED",
  "ocrText": "...",
  "translatedText": "...",
  "annotations": [...],
  "semanticGroups": {...}
}
```

#### 创建文档记录
```
POST /api/documents
Content-Type: application/json

{
  "fileName": "paper.pdf",
  "fileSize": 1024000,
  "fileType": "pdf",
  "status": "PENDING"
}

Response:
{
  "id": "uuid",
  ...
}

Error (配额超出):
{
  "error": "Monthly document quota exceeded (100 documents)"
}
```

#### 更新文档
```
PUT /api/documents/:id
Content-Type: application/json

{
  "status": "OCR_COMPLETED",
  "ocrText": "...",
  "ocrProvider": "mineru"
}
```

#### 删除文档
```
DELETE /api/documents/:id
```

---

### 标注管理

#### 获取文档的所有标注
```
GET /api/documents/:id/annotations

Response:
[
  {
    "id": "uuid",
    "type": "highlight",
    "color": "#ffff00",
    "startIndex": 100,
    "endIndex": 200,
    "text": "高亮文本",
    "note": "我的笔记"
  }
]
```

#### 创建标注
```
POST /api/documents/:id/annotations
Content-Type: application/json

{
  "type": "highlight",
  "color": "#ffff00",
  "startIndex": 100,
  "endIndex": 200,
  "text": "高亮文本",
  "note": "我的笔记"
}
```

#### 更新标注
```
PUT /api/documents/:documentId/annotations/:annotationId
Content-Type: application/json

{
  "note": "更新后的笔记"
}
```

#### 删除标注
```
DELETE /api/documents/:documentId/annotations/:annotationId
```

---

### 意群数据

#### 保存/更新意群数据
```
POST /api/documents/:id/semantic-groups
Content-Type: application/json

{
  "groups": [
    {
      "id": 1,
      "text": "语义组1",
      "translation": "翻译1"
    },
    {
      "id": 2,
      "text": "语义组2",
      "translation": "翻译2"
    }
  ],
  "version": "1.0",
  "source": "auto"
}
```

#### 获取意群数据
```
GET /api/documents/:id/semantic-groups

Response:
{
  "id": "uuid",
  "documentId": "doc-uuid",
  "groups": [...],
  "version": "1.0",
  "source": "auto",
  "createdAt": "...",
  "updatedAt": "..."
}
```

---

## 管理员 API

所有管理员 API 都需要 ADMIN 角色。

### 用户管理

#### 获取所有用户
```
GET /api/admin/users

Response:
[
  {
    "id": "uuid",
    "email": "user@example.com",
    "name": "User Name",
    "role": "USER",
    "isActive": true,
    "createdAt": "..."
  }
]
```

#### 更新用户状态
```
PUT /api/admin/users/:id/status
Content-Type: application/json

{
  "isActive": false
}
```

---

### 统计信息

#### 获取基础统计
```
GET /api/admin/stats

Response:
{
  "totalUsers": 150,
  "activeUsers": 120,
  "totalDocuments": 5432,
  "documentsToday": 45
}
```

#### 获取详细统计
```
GET /api/admin/stats/detailed

Response:
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
    {"status": "COMPLETED", "count": 4500},
    {"status": "FAILED", "count": 100}
  ],
  "topUsers": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "documentCount": 234
    }
  ]
}
```

#### 获取使用趋势
```
GET /api/admin/stats/trends?days=30

Response:
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

### 用户配额管理

#### 获取用户配额
```
GET /api/admin/users/:userId/quota

Response:
{
  "id": "uuid",
  "userId": "user-uuid",
  "maxDocumentsPerDay": -1,
  "maxDocumentsPerMonth": 100,
  "maxStorageSize": 1024,
  "maxApiKeysCount": -1,
  "documentsThisMonth": 45,
  "currentStorageUsed": 256,
  "lastMonthlyReset": "2025-01-01T..."
}
```

#### 更新用户配额
```
PUT /api/admin/users/:userId/quota
Content-Type: application/json

{
  "maxDocumentsPerMonth": 200,
  "maxStorageSize": 2048
}
```

---

### 用户活动日志

#### 获取用户活动
```
GET /api/admin/users/:userId/activity?limit=50&offset=0

Response:
[
  {
    "id": "uuid",
    "userId": "user-uuid",
    "action": "document_create",
    "resourceId": "doc-uuid",
    "metadata": {
      "fileName": "paper.pdf",
      "fileType": "pdf"
    },
    "createdAt": "2025-01-17T..."
  }
]
```

---

### 系统配置

#### 获取系统配置
```
GET /api/admin/config

Response:
{
  "allowRegistration": "true",
  "maxUploadSize": "100"
}
```

#### 更新系统配置
```
PUT /api/admin/config
Content-Type: application/json

{
  "key": "allowRegistration",
  "value": "false",
  "description": "是否允许用户注册"
}
```

---

### 自定义源站管理

#### 获取全局源站列表
```
GET /api/admin/source-sites

Response:
[
  {
    "id": "uuid",
    "displayName": "自定义模型",
    "apiBaseUrl": "https://api.example.com",
    "modelId": "model-name",
    "availableModels": ["model-1", "model-2"],
    "requestFormat": "openai"
  }
]
```

#### 创建全局源站
```
POST /api/admin/source-sites
Content-Type: application/json

{
  "displayName": "自定义模型",
  "apiBaseUrl": "https://api.example.com",
  "modelId": "model-name",
  "availableModels": ["model-1"],
  "requestFormat": "openai"
}
```

#### 更新源站
```
PUT /api/admin/source-sites/:id
```

#### 删除源站
```
DELETE /api/admin/source-sites/:id
```

---

## 认证 API

### 注册
```
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123",
  "name": "User Name"
}

Response:
{
  "success": true,
  "token": "jwt-token",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "User Name",
    "role": "USER"
  }
}
```

### 登录
```
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}

Response:
{
  "success": true,
  "token": "jwt-token",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "User Name",
    "role": "USER"
  }
}
```

### 获取当前用户
```
GET /api/auth/me
Authorization: Bearer <token>

Response:
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "User Name",
    "role": "USER",
    "createdAt": "..."
  }
}
```

---

## 健康检查

```
GET /api/health

Response:
{
  "status": "ok",
  "timestamp": 1705478400000,
  "mode": "docker",
  "version": "1.0.0"
}
```

---

## 错误响应

所有错误响应遵循以下格式：

```json
{
  "error": "错误描述信息"
}
```

常见 HTTP 状态码：
- `200` - 成功
- `201` - 创建成功
- `400` - 请求参数错误
- `401` - 未认证
- `403` - 权限不足 / 配额超出
- `404` - 资源不存在
- `409` - 冲突（如邮箱已存在）
- `500` - 服务器错误

---

## 分页

支持分页的端点使用以下参数：

```
?page=1&limit=20
```

响应格式：

```json
{
  "data": [...],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 150,
    "totalPages": 8
  }
}
```

---

## 使用示例

### JavaScript / Fetch

```javascript
// 登录
const loginResponse = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    password: 'password123'
  })
});
const { token } = await loginResponse.json();

// 获取文档列表
const docsResponse = await fetch('/api/documents?page=1&limit=20', {
  headers: { 'Authorization': `Bearer ${token}` }
});
const { documents, pagination } = await docsResponse.json();

// 创建文档
const createResponse = await fetch('/api/documents', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    fileName: 'paper.pdf',
    fileSize: 1024000,
    fileType: 'pdf',
    status: 'PENDING'
  })
});
const newDoc = await createResponse.json();
```

### cURL

```bash
# 登录
TOKEN=$(curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@paperburner.local","password":"admin123456"}' \
  | jq -r '.token')

# 获取统计
curl http://localhost:3000/api/admin/stats \
  -H "Authorization: Bearer $TOKEN"

# 创建 API Key
curl -X POST http://localhost:3000/api/user/api-keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"deepseek","keyValue":"sk-...","remark":"主密钥"}'
```

---

**最后更新**: 2025-01-17
