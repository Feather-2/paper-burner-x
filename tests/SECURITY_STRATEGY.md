# Paper Burner X - 双模式部署安全策略指南

**更新时间：** 2025-11-05
**目标读者：** 开发者、部署人员、系统管理员

---

## 📋 目录

- [核心问题：如何平衡安全与可用性](#-核心问题如何平衡安全与可用性)
- [前端模式安全策略](#-前端模式安全策略)
- [后端模式安全策略](#-后端模式安全策略)
- [混合部署方案](#-混合部署方案)
- [安全检查清单](#-安全检查清单)
- [常见问题解答](#-常见问题解答)

---

## 🎯 核心问题：如何平衡安全与可用性

### 问题陈述

Paper Burner X 采用**双模式部署**架构：

1. **前端模式** - 纯静态部署，数据存储在浏览器本地
2. **后端模式** - Docker 部署，包含后端服务和数据库

**核心挑战：**
- 前端模式需要保持零部署成本和离线可用性
- 但前端模式无法提供服务端级别的安全保障
- 如何在两者之间找到平衡？

### 解决方案：分级安全策略

我们采用**分级安全策略**，根据不同模式提供不同级别的安全保障：

| 维度 | 前端模式策略 | 后端模式策略 |
|-----|------------|------------|
| **目标** | 尽力而为的安全 + 用户教育 | 企业级安全保障 |
| **安全等级** | ⭐⭐⭐ (中等) | ⭐⭐⭐⭐⭐ (高) |
| **实施方式** | 客户端防护 + 警告提示 | 服务端验证 + 多层防护 |
| **适用场景** | 个人使用、学习研究 | 团队协作、生产环境 |

**核心原则：**
- ✅ **透明度** - 明确告知用户当前模式的安全限制
- ✅ **用户选择** - 让用户根据需求选择合适的模式
- ✅ **平滑升级** - 支持从前端模式无缝升级到后端模式
- ✅ **最小化风险** - 在各自模式下实施最大程度的安全措施

---

## 🌐 前端模式安全策略

### 安全定位

**安全等级：** ⭐⭐⭐ (中等 - 依赖用户环境和浏览器安全性)

**核心理念：**
> 前端模式无法提供服务端级别的安全保障，但可以通过客户端防护、用户教育和最佳实践，将风险降至可接受范围。

### 1. 数据存储安全

#### 问题：localStorage 的安全风险

**风险分析：**
```javascript
// ⚠️ 当前实现（存在风险）
localStorage.setItem('mistral_api_keys', JSON.stringify(apiKeys));

// 风险点：
// 1. XSS 攻击可读取 localStorage
// 2. 浏览器插件可访问
// 3. 用户可在控制台直接查看
// 4. 加密密钥硬编码在前端代码中
```

#### 解决方案 A：sessionStorage + Web Crypto API（推荐）

**实施步骤：**

```javascript
// js/utils/secure-storage.js (新建)

/**
 * 安全存储工具 - 前端模式专用
 * 使用 sessionStorage + Web Crypto API 加密
 */
export class SecureStorage {
  constructor() {
    this.encryptionKey = null;
    this.init();
  }

  /**
   * 初始化加密密钥
   * 密钥仅在会话期间存在，刷新页面后重新生成
   */
  async init() {
    let keyData = sessionStorage.getItem('_ek');

    if (!keyData) {
      // 首次访问，生成随机密钥
      const key = await window.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );

      // 导出密钥并存储
      const exportedKey = await window.crypto.subtle.exportKey('raw', key);
      keyData = this.arrayBufferToBase64(exportedKey);
      sessionStorage.setItem('_ek', keyData);

      // 显示安全提示
      this.showSecurityNotice();
    }

    // 导入密钥
    const keyBuffer = this.base64ToArrayBuffer(keyData);
    this.encryptionKey = await window.crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * 安全存储数据
   */
  async setItem(key, value) {
    if (!this.encryptionKey) await this.init();

    // 生成随机 IV
    const iv = window.crypto.getRandomValues(new Uint8Array(12));

    // 加密数据
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(value));
    const encrypted = await window.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this.encryptionKey,
      data
    );

    // 存储加密数据 + IV
    const combined = {
      iv: this.arrayBufferToBase64(iv),
      data: this.arrayBufferToBase64(encrypted)
    };

    sessionStorage.setItem(key, JSON.stringify(combined));
  }

  /**
   * 读取数据
   */
  async getItem(key) {
    if (!this.encryptionKey) await this.init();

    const stored = sessionStorage.getItem(key);
    if (!stored) return null;

    try {
      const { iv, data } = JSON.parse(stored);

      // 解密
      const decrypted = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: this.base64ToArrayBuffer(iv) },
        this.encryptionKey,
        this.base64ToArrayBuffer(data)
      );

      const decoder = new TextDecoder();
      return JSON.parse(decoder.decode(decrypted));
    } catch (error) {
      console.error('解密失败:', error);
      return null;
    }
  }

  /**
   * 删除数据
   */
  removeItem(key) {
    sessionStorage.removeItem(key);
  }

  /**
   * 显示安全提示（仅首次）
   */
  showSecurityNotice() {
    const noticeShown = localStorage.getItem('security_notice_shown');
    if (noticeShown) return;

    const modal = document.createElement('div');
    modal.className = 'security-notice-modal';
    modal.innerHTML = `
      <div class="modal-overlay"></div>
      <div class="modal-content">
        <h2>⚠️ 前端模式安全提示</h2>
        <div class="notice-text">
          <p><strong>当前使用前端模式，数据存储在浏览器本地。</strong></p>
          <ul>
            <li>✅ 零部署成本，完全离线可用</li>
            <li>✅ 数据不会上传到任何服务器</li>
            <li>⚠️ API 密钥存储在浏览器会话中</li>
            <li>⚠️ 请勿在公共或共享设备上使用</li>
            <li>⚠️ 关闭标签页后数据将清除</li>
          </ul>
          <p><strong>建议：</strong></p>
          <ul>
            <li>个人使用、学习研究 → 使用前端模式 ✅</li>
            <li>团队协作、生产环境 → 使用 <a href="/docs/DEPLOYMENT_GUIDE.md">Docker 后端模式</a> 🐳</li>
          </ul>
        </div>
        <div class="modal-actions">
          <label>
            <input type="checkbox" id="dont-show-again"> 不再显示
          </label>
          <button id="close-notice">我知道了</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // 关闭逻辑
    document.getElementById('close-notice').addEventListener('click', () => {
      if (document.getElementById('dont-show-again').checked) {
        localStorage.setItem('security_notice_shown', 'true');
      }
      modal.remove();
    });
  }

  // 辅助方法
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

// 导出单例
export const secureStorage = new SecureStorage();
```

**使用方式：**

```javascript
// 替换原有的 localStorage 调用
import { secureStorage } from './utils/secure-storage.js';

// 存储 API 密钥
await secureStorage.setItem('api_keys', {
  mistral: ['key1', 'key2'],
  openai: ['key3']
});

// 读取 API 密钥
const keys = await secureStorage.getItem('api_keys');
```

**优势：**
- ✅ 使用浏览器原生 Web Crypto API（强加密）
- ✅ 密钥仅在会话期间存在
- ✅ 关闭标签页后自动清除
- ✅ 无法通过控制台直接查看
- ✅ 首次使用显示安全提示

**限制：**
- ⚠️ 刷新页面后需要重新输入 API 密钥
- ⚠️ 无法跨标签页共享数据
- ⚠️ XSS 攻击仍可能在运行时窃取数据

---

#### 解决方案 B：Cloudflare Workers 代理（最安全）

**架构图：**
```
用户浏览器 → Cloudflare Worker → 第三方 API (Mistral/OpenAI)
              ↑
              密钥存储在 Worker 环境变量（安全）
```

**实施步骤：**

1. **创建 Cloudflare Worker**

```javascript
// workers/api-proxy.js

export default {
  async fetch(request, env, ctx) {
    // 仅允许特定域名访问
    const allowedOrigins = [
      'https://paperburner.viwoplus.site',
      'http://localhost:5173'
    ];

    const origin = request.headers.get('Origin');
    if (!allowedOrigins.includes(origin)) {
      return new Response('Forbidden', { status: 403 });
    }

    // 解析请求
    const url = new URL(request.url);
    const targetApi = url.searchParams.get('api'); // 'mistral' or 'openai'

    if (!targetApi) {
      return new Response('Missing API parameter', { status: 400 });
    }

    // 获取对应的 API 密钥（存储在 Worker 环境变量）
    const apiKey = targetApi === 'mistral'
      ? env.MISTRAL_API_KEY
      : env.OPENAI_API_KEY;

    if (!apiKey) {
      return new Response('API key not configured', { status: 500 });
    }

    // 代理请求到目标 API
    const targetUrl = targetApi === 'mistral'
      ? 'https://api.mistral.ai/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: await request.text()
    });

    // 返回响应（添加 CORS 头）
    const modifiedResponse = new Response(response.body, response);
    modifiedResponse.headers.set('Access-Control-Allow-Origin', origin);
    modifiedResponse.headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    modifiedResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type');

    return modifiedResponse;
  }
};
```

2. **部署 Worker**

```bash
# 安装 Wrangler CLI
npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 创建项目
wrangler init paper-burner-proxy

# 配置环境变量
wrangler secret put MISTRAL_API_KEY
wrangler secret put OPENAI_API_KEY

# 部署
wrangler publish
```

3. **前端调用代理**

```javascript
// js/services/api-client.js

export class ApiClient {
  constructor(proxyUrl) {
    // 使用代理 URL，而非直接调用 API
    this.proxyUrl = proxyUrl || 'https://api-proxy.your-domain.workers.dev';
  }

  async chat(messages, model = 'mistral-large-latest') {
    const api = model.startsWith('mistral') ? 'mistral' : 'openai';

    const response = await fetch(`${this.proxyUrl}?api=${api}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ messages, model })
    });

    if (!response.ok) {
      throw new Error(`API Error: ${response.status}`);
    }

    return response.json();
  }
}

// 使用
const client = new ApiClient();
const result = await client.chat([
  { role: 'user', content: 'Hello!' }
]);
```

**优势：**
- ✅ API 密钥完全不暴露给前端
- ✅ 用户无需管理密钥
- ✅ 可以实施速率限制
- ✅ 可以添加使用统计
- ✅ 安全等级接近后端模式

**限制：**
- ⚠️ 需要 Cloudflare Workers 账号（免费额度通常足够）
- ⚠️ 增加了一层网络延迟（通常 <50ms）
- ⚠️ 需要管理 Worker 的配额

**成本：**
- Cloudflare Workers 免费额度：每天 100,000 次请求
- 超出后：$0.15/百万请求

---

### 2. XSS 防护

#### 问题：innerHTML 的安全风险

**风险代码示例：**
```javascript
// ⚠️ 危险
element.innerHTML = userContent;

// ⚠️ 属性注入
element.setAttribute('onclick', `handleClick('${userName}')`);
```

#### 解决方案：统一安全工具

```javascript
// js/utils/security.js

/**
 * XSS 防护工具集
 */
export const SecurityUtils = {
  /**
   * HTML 转义
   */
  escapeHtml(unsafe) {
    if (typeof unsafe !== 'string') return unsafe;

    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };

    return unsafe.replace(/[&<>"']/g, (m) => map[m]);
  },

  /**
   * 安全地设置文本内容
   */
  setText(element, text) {
    element.textContent = text;
  },

  /**
   * 安全地设置 HTML（使用白名单）
   */
  setHTML(element, html, allowedTags = []) {
    if (allowedTags.length === 0) {
      // 不允许任何标签，使用纯文本
      element.textContent = html;
      return;
    }

    // 简单的白名单过滤器
    const regex = new RegExp(`<(?!\/?(${allowedTags.join('|')})\\b)[^>]*>`, 'gi');
    const sanitized = html.replace(regex, '');
    element.innerHTML = sanitized;
  },

  /**
   * 安全地设置属性
   */
  setAttribute(element, attr, value) {
    // 禁止事件属性
    if (attr.startsWith('on')) {
      console.error(`不允许设置事件属性: ${attr}`);
      return;
    }

    // 对于 href 和 src，检查协议
    if (attr === 'href' || attr === 'src') {
      const url = value.trim().toLowerCase();
      if (url.startsWith('javascript:') || url.startsWith('data:')) {
        console.error(`不允许的 URL 协议: ${url}`);
        return;
      }
    }

    element.setAttribute(attr, this.escapeHtml(value));
  },

  /**
   * 创建元素的安全方法
   */
  createElement(tag, attributes = {}, textContent = '') {
    const element = document.createElement(tag);

    for (const [attr, value] of Object.entries(attributes)) {
      this.setAttribute(element, attr, value);
    }

    if (textContent) {
      this.setText(element, textContent);
    }

    return element;
  }
};

/**
 * 使用示例
 */

// ❌ 旧代码（不安全）
const userNameElement = document.createElement('div');
userNameElement.innerHTML = `<strong>${userName}</strong>`;

// ✅ 新代码（安全）
import { SecurityUtils } from './utils/security.js';

const userNameElement = SecurityUtils.createElement('div');
const strong = SecurityUtils.createElement('strong', {}, userName);
userNameElement.appendChild(strong);
```

---

### 3. CSP (Content Security Policy) 配置

#### 通过 meta 标签实施 CSP

```html
<!-- index.html -->
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">

  <!-- CSP 策略 -->
  <meta http-equiv="Content-Security-Policy"
        content="
          default-src 'self';
          script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net;
          style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
          font-src 'self' https://fonts.gstatic.com;
          img-src 'self' data: https:;
          connect-src 'self' https://api.mistral.ai https://api.openai.com https://*.workers.dev;
          frame-src 'none';
          object-src 'none';
          base-uri 'self';
          form-action 'self';
        ">

  <title>Paper Burner X</title>
</head>
```

**说明：**
- `default-src 'self'` - 默认仅允许同源资源
- `script-src 'self' 'unsafe-inline'` - 允许内联脚本（渐进式移除）
- `connect-src` - 限制 API 请求目标
- `frame-src 'none'` - 禁止嵌入 iframe
- `object-src 'none'` - 禁止 Flash 等对象

#### 渐进式移除 'unsafe-inline'

**步骤 1：提取所有内联脚本**
```html
<!-- ❌ 旧方式 -->
<button onclick="handleClick()">点击</button>
<script>
  function handleClick() { ... }
</script>

<!-- ✅ 新方式 -->
<button id="my-button">点击</button>
<script src="/js/main.js"></script>

<!-- js/main.js -->
document.getElementById('my-button').addEventListener('click', handleClick);
```

**步骤 2：使用 nonce（仅对必要的内联脚本）**
```html
<!-- 生成随机 nonce -->
<script nonce="RANDOM_GENERATED_NONCE">
  // 必要的初始化代码
  window.ENV_DEPLOYMENT_MODE = 'auto';
</script>

<!-- CSP 策略中添加 -->
<meta http-equiv="Content-Security-Policy"
      content="script-src 'self' 'nonce-RANDOM_GENERATED_NONCE';">
```

---

### 4. 前端模式安全检查清单

在部署前端模式时，请确保：

- [ ] **数据存储**
  - [ ] API 密钥使用 sessionStorage 或代理
  - [ ] 显示明确的安全警告
  - [ ] 敏感数据使用 Web Crypto API 加密
  - [ ] 不在 localStorage 明文存储密钥

- [ ] **XSS 防护**
  - [ ] 所有 innerHTML 使用已审查或替换为 textContent
  - [ ] 用户输入经过转义
  - [ ] 使用 SecurityUtils 工具集
  - [ ] 移除或替换事件属性（onclick 等）

- [ ] **CSP 配置**
  - [ ] CSP meta 标签已添加
  - [ ] 限制 connect-src 到必要的 API
  - [ ] 禁止 frame-src 和 object-src
  - [ ] 计划移除 'unsafe-inline'

- [ ] **第三方资源**
  - [ ] CDN 资源使用 SRI (Subresource Integrity)
  - [ ] 仅使用可信的 CDN（jsdelivr, unpkg）
  - [ ] 定期审查第三方依赖

- [ ] **用户教育**
  - [ ] 首次访问显示安全提示
  - [ ] 文档中明确说明安全限制
  - [ ] 提供升级到后端模式的指引

---

## 🐳 后端模式安全策略

### 安全定位

**安全等级：** ⭐⭐⭐⭐⭐ (高 - 企业级安全)

**核心理念：**
> 后端模式提供完整的服务端安全保障，适合团队协作和生产环境。

### 1. 身份认证与授权

#### 当前实现（已完成）

✅ **JWT Token 认证**
- Token 有效期：24 小时
- 使用 bcrypt 哈希密码（10 轮）
- 支持角色权限控制（user/admin）

✅ **密码强度验证**
- 最小长度 8 字符
- 必须包含字母和数字

#### 待加强项

🔸 **会话管理增强**

```javascript
// server/src/middleware/session.js (新建)

import session from 'express-session';
import RedisStore from 'connect-redis';
import { redisClient } from '../utils/cache.js';

export function setupSession(app) {
  app.use(session({
    store: redisClient ? new RedisStore({ client: redisClient }) : undefined,
    secret: process.env.SESSION_SECRET || process.env.JWT_SECRET,
    resave: false,
    saveUninitialized: false,
    name: 'pb.sid', // 自定义 session ID 名称
    cookie: {
      secure: process.env.NODE_ENV === 'production', // HTTPS only
      httpOnly: true, // 防止 JS 访问
      maxAge: 24 * 60 * 60 * 1000, // 24 小时
      sameSite: 'strict' // CSRF 保护
    }
  }));
}
```

🔸 **多因素认证（可选）**

```javascript
// server/src/utils/totp.js (新建)

import speakeasy from 'speakeasy';
import QRCode from 'qrcode';

export class TotpService {
  /**
   * 为用户生成 TOTP 密钥
   */
  static generateSecret(userEmail) {
    return speakeasy.generateSecret({
      name: `Paper Burner (${userEmail})`,
      issuer: 'Paper Burner X'
    });
  }

  /**
   * 生成 QR 码
   */
  static async generateQRCode(secret) {
    return await QRCode.toDataURL(secret.otpauth_url);
  }

  /**
   * 验证 TOTP 令牌
   */
  static verifyToken(secret, token) {
    return speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: token,
      window: 2 // 允许 ±2 个时间步长
    });
  }
}

// 使用示例
app.post('/api/auth/2fa/enable', requireAuth, async (req, res) => {
  const secret = TotpService.generateSecret(req.user.email);
  const qrCode = await TotpService.generateQRCode(secret);

  // 保存 secret 到用户记录（加密）
  await prisma.user.update({
    where: { id: req.user.id },
    data: {
      totpSecret: encrypt(secret.base32),
      totpEnabled: false // 验证后再启用
    }
  });

  res.json({ qrCode, secret: secret.base32 });
});

app.post('/api/auth/2fa/verify', requireAuth, async (req, res) => {
  const { token } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });

  const secret = decrypt(user.totpSecret);
  const isValid = TotpService.verifyToken(secret, token);

  if (isValid) {
    // 启用 2FA
    await prisma.user.update({
      where: { id: req.user.id },
      data: { totpEnabled: true }
    });
    res.json({ success: true });
  } else {
    res.status(400).json({ error: '验证码错误' });
  }
});
```

---

### 2. 数据安全

#### API 密钥管理（已实施）

✅ **服务端加密存储**
- 使用 AES-256-GCM 加密
- 密钥派生自环境变量

#### 待加强项

🔸 **密钥轮换策略**

```javascript
// server/src/utils/key-rotation.js (新建)

export class KeyRotationService {
  /**
   * 检查密钥年龄
   */
  static async checkKeyAge(userId) {
    const keys = await prisma.apiKey.findMany({
      where: { userId }
    });

    const now = new Date();
    const warnings = [];

    for (const key of keys) {
      const ageInDays = Math.floor((now - key.createdAt) / (1000 * 60 * 60 * 24));

      if (ageInDays > 90) {
        warnings.push({
          keyId: key.id,
          provider: key.provider,
          ageInDays,
          message: '建议更换密钥（超过 90 天）'
        });
      }
    }

    return warnings;
  }

  /**
   * 定期任务：发送密钥轮换提醒
   */
  static async sendRotationReminders() {
    const users = await prisma.user.findMany({
      where: { isActive: true }
    });

    for (const user of users) {
      const warnings = await this.checkKeyAge(user.id);
      if (warnings.length > 0) {
        // 发送邮件或通知
        await this.sendEmail(user.email, warnings);
      }
    }
  }
}

// 定时任务（每周一次）
import cron from 'node-cron';

cron.schedule('0 0 * * 1', async () => {
  console.log('执行密钥轮换检查...');
  await KeyRotationService.sendRotationReminders();
});
```

---

### 3. 网络安全

#### Rate Limiting（部分实施）

✅ **已实施：**
- OCR 路由限流
- Admin 统计接口限流

#### 待加强项

🔸 **全局 Rate Limiting**

```javascript
// server/src/middleware/rate-limit.js (新建)

import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { redisClient } from '../utils/cache.js';

/**
 * 全局限流（所有接口）
 */
export const globalLimiter = rateLimit({
  store: redisClient ? new RedisStore({ client: redisClient }) : undefined,
  windowMs: 15 * 60 * 1000, // 15 分钟
  max: 1000, // 限制 1000 次请求
  message: { error: '请求过于频繁，请稍后再试' },
  standardHeaders: true,
  legacyHeaders: false
});

/**
 * 认证接口严格限流
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 限制 5 次尝试
  skipSuccessfulRequests: true, // 成功的不计数
  message: { error: '登录尝试次数过多，请 15 分钟后再试' }
});

/**
 * API 密集型接口限流
 */
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 分钟
  max: 20, // 限制 20 次
  message: { error: 'API 请求过于频繁' }
});

// 使用
// server/src/index.js
import { globalLimiter, authLimiter, apiLimiter } from './middleware/rate-limit.js';

app.use('/api', globalLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/documents', apiLimiter);
```

🔸 **CSRF 保护**

```javascript
// server/src/middleware/csrf.js (新建)

import csrf from 'csurf';
import { DEPLOYMENT_MODE } from '../utils/constants.js';

// 仅后端模式启用 CSRF
export const csrfProtection = process.env.DEPLOYMENT_MODE === 'backend'
  ? csrf({ cookie: true })
  : (req, res, next) => next(); // 前端模式跳过

// 提供 CSRF Token 接口
app.get('/api/csrf-token', (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

// 应用到需要保护的路由
app.use('/api/', csrfProtection);
```

---

### 4. 安全审计日志

```javascript
// server/prisma/schema.prisma

model AuditLog {
  id        String   @id @default(uuid())
  userId    String?  @db.Uuid
  action    String   @db.VarChar(100)  // USER_LOGIN, DOCUMENT_DELETE 等
  details   Json?
  ip        String   @db.VarChar(45)
  userAgent String?  @db.VarChar(500)
  timestamp DateTime @default(now())

  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@index([userId])
  @@index([action])
  @@index([timestamp])
}
```

```javascript
// server/src/utils/audit.js (新建)

import { prisma } from './prisma.js';

export class AuditLogger {
  /**
   * 记录操作日志
   */
  static async log(req, action, details = {}) {
    try {
      await prisma.auditLog.create({
        data: {
          userId: req.user?.id,
          action,
          details,
          ip: req.ip || req.connection.remoteAddress,
          userAgent: req.get('user-agent'),
          timestamp: new Date()
        }
      });
    } catch (error) {
      console.error('审计日志写入失败:', error);
    }
  }

  /**
   * 查询审计日志
   */
  static async query(filters = {}) {
    const { userId, action, startDate, endDate, limit = 100 } = filters;

    return await prisma.auditLog.findMany({
      where: {
        userId,
        action,
        timestamp: {
          gte: startDate,
          lte: endDate
        }
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
      include: { user: { select: { email: true, name: true } } }
    });
  }
}

// 使用示例
app.post('/api/admin/users/:id/delete', requireAdmin, async (req, res) => {
  const { id } = req.params;
  const targetUser = await prisma.user.findUnique({ where: { id } });

  await prisma.user.delete({ where: { id } });

  // 记录审计日志
  await AuditLogger.log(req, 'USER_DELETED', {
    targetUserId: id,
    targetUserEmail: targetUser.email
  });

  res.json({ success: true });
});
```

---

### 5. 后端模式安全检查清单

部署后端模式前，请确保：

- [ ] **环境配置**
  - [ ] 所有密钥通过环境变量配置
  - [ ] 生产环境启用 HTTPS
  - [ ] 数据库连接使用 SSL
  - [ ] SESSION_SECRET 随机生成
  - [ ] CORS_ORIGIN 不是 '*'

- [ ] **身份认证**
  - [ ] JWT_SECRET 至少 32 字符
  - [ ] 密码哈希使用 bcrypt
  - [ ] Token 过期时间合理（24h）
  - [ ] 支持管理员和普通用户角色

- [ ] **数据安全**
  - [ ] API 密钥服务端加密存储
  - [ ] ENCRYPTION_SECRET 环境变量设置
  - [ ] 敏感数据不在日志中输出
  - [ ] 定期备份数据库

- [ ] **网络安全**
  - [ ] Rate Limiting 覆盖所有公共接口
  - [ ] CSRF Token 验证
  - [ ] CSP 头部配置
  - [ ] Helmet 中间件启用

- [ ] **监控与审计**
  - [ ] 审计日志记录关键操作
  - [ ] 错误日志不包含敏感信息
  - [ ] 健康检查接口可用
  - [ ] 性能监控（可选）

- [ ] **依赖安全**
  - [ ] 运行 `npm audit` 无高危漏洞
  - [ ] 定期更新依赖包
  - [ ] 使用 Dependabot（可选）

---

## 🔀 混合部署方案

### 场景：提供公共服务，但保护 API 密钥

**需求：**
- 前端静态托管（Vercel/GitHub Pages）
- 用户无需管理 API 密钥
- 提供有限的免费额度

**方案：前端 + Cloudflare Workers**

**架构：**
```
用户浏览器 (前端模式)
    ↓
Cloudflare Workers (API 代理 + 限流)
    ↓
第三方 API (Mistral/OpenAI)
```

**Workers 实现（带限流）：**

```javascript
// workers/api-proxy-with-limits.js

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. CORS 预检
    if (request.method === 'OPTIONS') {
      return this.handleCORS();
    }

    // 2. 验证来源
    const origin = request.headers.get('Origin');
    const allowedOrigins = env.ALLOWED_ORIGINS.split(',');
    if (!allowedOrigins.includes(origin)) {
      return new Response('Forbidden', { status: 403 });
    }

    // 3. IP 级别限流（使用 KV）
    const ip = request.headers.get('CF-Connecting-IP');
    const rateLimitKey = `ratelimit:${ip}`;

    const currentCount = await env.KV.get(rateLimitKey);
    if (currentCount && parseInt(currentCount) > 100) {
      return new Response(JSON.stringify({
        error: '今日免费额度已用完，请明天再试'
      }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // 4. 解析请求
    const targetApi = url.searchParams.get('api');
    const body = await request.json();

    // 5. 调用目标 API
    const apiKey = targetApi === 'mistral'
      ? env.MISTRAL_API_KEY
      : env.OPENAI_API_KEY;

    const targetUrl = targetApi === 'mistral'
      ? 'https://api.mistral.ai/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';

    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    // 6. 更新计数器
    const newCount = (parseInt(currentCount) || 0) + 1;
    await env.KV.put(rateLimitKey, newCount.toString(), {
      expirationTtl: 86400 // 24 小时后过期
    });

    // 7. 返回响应
    const result = await response.json();
    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': origin
      }
    });
  },

  handleCORS() {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      }
    });
  }
};
```

**前端配置：**

```javascript
// js/config.js

export const API_CONFIG = {
  // 检测是否使用代理
  useProxy: !!window.ENV_USE_API_PROXY,
  proxyUrl: window.ENV_PROXY_URL || 'https://api-proxy.your-domain.workers.dev'
};

// js/services/api-client.js

import { API_CONFIG } from '../config.js';

export class ApiClient {
  async chat(messages, model) {
    if (API_CONFIG.useProxy) {
      // 使用代理
      const api = model.startsWith('mistral') ? 'mistral' : 'openai';
      return await this.callProxy(api, messages, model);
    } else {
      // 使用用户自己的密钥
      return await this.callDirect(messages, model);
    }
  }

  async callProxy(api, messages, model) {
    const response = await fetch(`${API_CONFIG.proxyUrl}?api=${api}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, model })
    });

    if (!response.ok) {
      if (response.status === 429) {
        throw new Error('今日免费额度已用完，请明天再试或使用自己的 API 密钥');
      }
      throw new Error(`API Error: ${response.status}`);
    }

    return response.json();
  }

  async callDirect(messages, model) {
    // 用户自己的密钥
    const apiKey = await this.getUserApiKey(model);
    // ... 直接调用
  }
}
```

**优势：**
- ✅ 用户无需管理密钥即可试用
- ✅ 提供有限免费额度（防滥用）
- ✅ 也支持用户使用自己的密钥
- ✅ 安全性高

---

## ✅ 安全检查清单

### 前端模式部署检查清单

- [ ] **代码安全**
  - [ ] 已审查所有 innerHTML 使用
  - [ ] 已实施 XSS 防护
  - [ ] 已添加 CSP meta 标签
  - [ ] 已移除或保护事件属性

- [ ] **数据安全**
  - [ ] API 密钥使用 sessionStorage 或代理
  - [ ] 已显示安全警告
  - [ ] 敏感数据已加密

- [ ] **第三方资源**
  - [ ] CDN 资源使用 SRI
  - [ ] 已审查所有第三方依赖

- [ ] **用户教育**
  - [ ] 文档说明安全限制
  - [ ] 首次访问显示提示

---

### 后端模式部署检查清单

- [ ] **环境配置**
  - [ ] 所有密钥通过环境变量
  - [ ] 生产环境 NODE_ENV=production
  - [ ] 启用 HTTPS
  - [ ] 数据库 SSL 连接

- [ ] **认证授权**
  - [ ] JWT_SECRET 足够复杂
  - [ ] 密码强度验证
  - [ ] 会话管理正确

- [ ] **网络安全**
  - [ ] CORS 限制源
  - [ ] Rate Limiting 启用
  - [ ] CSP 头部配置
  - [ ] Helmet 中间件

- [ ] **数据安全**
  - [ ] API 密钥加密存储
  - [ ] 数据库定期备份
  - [ ] 日志不含敏感信息

- [ ] **监控审计**
  - [ ] 审计日志启用
  - [ ] 健康检查可用
  - [ ] 错误监控（可选）

---

## ❓ 常见问题解答

### Q1: 前端模式真的安全吗？

**A:** 前端模式提供**有限的安全性**，依赖于：
- 用户的浏览器安全性
- 用户的设备安全性
- 用户的安全意识

**适合：** 个人学习、研究使用
**不适合：** 团队协作、生产环境、敏感数据处理

**建议：**
- 使用 Cloudflare Workers 代理（提供接近后端的安全性）
- 或升级到完整的后端模式

---

### Q2: 如何从前端模式升级到后端模式？

**A:** 升级步骤：

1. **部署后端服务**
```bash
git clone https://github.com/your-repo/paper-burner-x.git
cd paper-burner-x
cp .env.example .env
nano .env  # 配置环境变量
docker-compose up -d
```

2. **前端自动切换**
```javascript
// 前端会自动探测后端可用性
// 如果 /api/health 返回 200，自动切换到后端模式
```

3. **数据迁移（可选）**
```javascript
// 导出前端模式数据
const data = {
  settings: localStorage.getItem('settings'),
  documents: await getAllDocumentsFromIndexedDB()
};

// 导入到后端模式
// 登录后，通过 API 上传数据
```

---

### Q3: Cloudflare Workers 代理的成本如何？

**A:** 成本非常低：

- **免费额度：** 每天 100,000 次请求
- **超出后：** $0.15/百万请求

**示例计算：**
- 假设每个用户每天 50 次请求
- 免费额度可支持 2,000 活跃用户/天
- 超出后，10,000 用户/天成本约 $0.75

**建议：**
- 小型个人项目：完全免费
- 中型项目（<5000 用户）：每月成本 <$50
- 大型项目：建议使用完整后端模式

---

### Q4: 如何实施最小化的安全改进？

**A:** 优先级排序（快速见效）：

**1. 立即修复（1 小时）：**
- [ ] initAdmin.js 不打印密码（5 分钟）
- [ ] 添加安全警告提示（15 分钟）
- [ ] CSP meta 标签（10 分钟）

**2. 本周完成（1-2 天）：**
- [ ] XSS 防护（审查 innerHTML）
- [ ] sessionStorage 替代 localStorage
- [ ] SecurityUtils 工具集

**3. 两周内完成（3-5 天）：**
- [ ] Cloudflare Workers 代理
- [ ] 或实施 Web Crypto API 加密
- [ ] Rate Limiting（后端模式）

---

## 📚 相关文档

- [代码审查报告](CODE_REVIEW.md)
- [部署指南](deploy/DEPLOYMENT_GUIDE.md)
- [API 参考](docs/API_REFERENCE.md)

---

**文档版本：** 1.0.0
**维护者：** Paper Burner X Team
**更新日期：** 2025-11-05
