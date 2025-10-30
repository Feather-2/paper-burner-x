import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// 导入路由
import authRoutes from './routes/auth.js';
import ocrRoutes from './routes/ocr.js';
import translationRoutes from './routes/translation.js';
import documentRoutes from './routes/document.js';
import userRoutes from './routes/user.js';
import adminRoutes from './routes/admin.js';
import glossaryRoutes from './routes/glossary.js';
import chatRoutes from './routes/chat.js';
import referenceRoutes from './routes/reference.js';
import promptPoolRoutes from './routes/prompt-pool.js';

// 导入中间件
import { errorHandler } from './middleware/errorHandler.js';
import { notFound } from './middleware/notFound.js';

// 导入初始化脚本
import { initializeAdmin } from './utils/initAdmin.js';

// 环境变量
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== 中间件配置 ====================

// 安全头部（CSP）
const isProd = process.env.NODE_ENV === 'production';
const disableCSP = process.env.DISABLE_CSP === 'true';
// 根据部署模式/环境变量决定是否允许内联脚本，以兼容前端模式
const deploymentMode = process.env.DEPLOYMENT_MODE || 'frontend';
const allowInline = process.env.CSP_ALLOW_INLINE === 'true' || deploymentMode === 'frontend';

// Helmet v8 使用驼峰指令名（camelCase）。
// 为兼容现有页面，暂时允许内联脚本与常用 CDN；后续建议改为外部文件 + nonce。
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: [
    "'self'",
    ...(allowInline ? ["'unsafe-inline'"] : []),
    'https://cdn.tailwindcss.com',
    'https://cdn.jsdelivr.net',
    'https://gcore.jsdelivr.net',
    'https://cdnjs.cloudflare.com',
    'https://unpkg.com',
  ],
  // 明确元素级脚本与内联事件来源
  scriptSrcElem: [
    "'self'",
    ...(allowInline ? ["'unsafe-inline'"] : []),
    'https://cdn.tailwindcss.com',
    'https://cdn.jsdelivr.net',
    'https://gcore.jsdelivr.net',
    'https://cdnjs.cloudflare.com',
    'https://unpkg.com',
  ],
  scriptSrcAttr: ["'self'", ...(allowInline ? ["'unsafe-inline'"] : [])],
  // 样式与字体
  styleSrc: [
    "'self'",
    "'unsafe-inline'",
    'https://cdn.jsdelivr.net',
    'https://gcore.jsdelivr.net',
    'https://cdn.tailwindcss.com',
    'https://fonts.googleapis.com',
    'https://cdnjs.cloudflare.com',
    'https://unpkg.com',
  ],
  imgSrc: ["'self'", 'data:'],
  // 字体：允许 Google 与常用 CDN（KaTeX、Iconify 等字体通过 CDN 加载）
  fontSrc: [
    "'self'",
    'data:',
    'https://fonts.gstatic.com',
    'https://cdn.jsdelivr.net',
    'https://gcore.jsdelivr.net',
    'https://cdnjs.cloudflare.com',
    'https://unpkg.com',
  ],
  // 前后端同源调用；如需跨域可按需补充具体域名
  connectSrc: [
    "'self'",
    // Iconify 在线图标 API 源（web component 会发起 fetch）
    'https://api.iconify.design',
    'https://api.unisvg.com',
    'https://api.simplesvg.com',
  ],
};

// CSP 构建工具与开关（便于调试/健康检查暴露）
const dashMap = {
  defaultSrc: 'default-src',
  scriptSrc: 'script-src',
  scriptSrcElem: 'script-src-elem',
  scriptSrcAttr: 'script-src-attr',
  styleSrc: 'style-src',
  imgSrc: 'img-src',
  fontSrc: 'font-src',
  connectSrc: 'connect-src',
};

const buildCspHeader = (directives) => {
  return Object.entries(dashMap)
    .filter(([key]) => Array.isArray(directives[key]) && directives[key].length > 0)
    .map(([key, headerName]) => `${headerName} ${directives[key].join(' ')}`)
    .join('; ');
};

const cspEnabled = isProd && !disableCSP;

// 仅使用 Helmet 其它安全头，CSP 由自定义中间件设置，避免指令名差异导致策略失效
app.use(helmet({ contentSecurityPolicy: false }));

// 识别头，便于快速确认命中正确版本
app.use((req, res, next) => {
  res.setHeader('X-PBX-App', 'paperburner-app');
  if (cspEnabled) {
    res.setHeader('X-PBX-CSP', buildCspHeader(cspDirectives));
  }
  next();
});

// 自定义 CSP 中间件（生产环境且未显式禁用时启用）
if (cspEnabled) {
  app.use((req, res, next) => {
    const cspHeaderValue = buildCspHeader(cspDirectives);
    // 确保不存在旧的 CSP 头被保留/合并
    res.removeHeader('Content-Security-Policy');
    res.setHeader('Content-Security-Policy', cspHeaderValue);
    // 已在标识头里也设置一份 X-PBX-CSP
    res.setHeader('X-PBX-CSP', cspHeaderValue);
    next();
  });
}

// CORS 配置
const isProduction = process.env.NODE_ENV === 'production';
// deploymentMode 已在上面声明，直接使用

let corsOrigin;
if (process.env.CORS_ORIGIN) {
  // 支持逗号分隔的多个源
  corsOrigin = process.env.CORS_ORIGIN.split(',').map(s => s.trim());
} else if (isProduction) {
  // 生产环境：默认限制为同源（必须配置）
  corsOrigin = false; // 不允许跨域
  console.error('❌ Production mode: CORS_ORIGIN not set, defaulting to same-origin only. Set CORS_ORIGIN env var.');
} else {
  // 开发/前端模式：允许所有源（但给出警告）
  corsOrigin = true; // 允许所有源
  console.warn('⚠️  CORS allows all origins. Set CORS_ORIGIN for production.');
}

const corsOptions = {
  origin: corsOrigin,
  // 注意：如果 origin 是 true（允许所有源），credentials 会被浏览器忽略
  credentials: corsOrigin !== true, // 只有当 origin 不是 true 时才设置 credentials
  optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// 日志
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
} else {
  app.use(morgan('combined'));
}

// 请求解析
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());

// Multer 文件上传配置
// 文件类型白名单（可通过环境变量配置）
const ALLOWED_MIME_TYPES = process.env.ALLOWED_MIME_TYPES
  ? process.env.ALLOWED_MIME_TYPES.split(',').map(s => s.trim())
  : [
      'application/pdf',
      'text/markdown',
      'text/plain',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
      'text/html',
      'application/epub+zip',
      'image/png',
      'image/jpeg',
      'image/jpg',
      'image/gif',
      'image/webp',
    ];

// 文件验证过滤器（可通过环境变量控制严格程度）
const FILE_VALIDATION_STRICT = process.env.FILE_VALIDATION_STRICT === 'true';
const fileFilter = (req, file, cb) => {
  // 非严格模式（前端模式）：允许所有文件类型
  if (!FILE_VALIDATION_STRICT) {
    cb(null, true);
    return;
  }

  // 严格模式：只允许白名单中的文件类型
  if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} not allowed. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`), false);
  }
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_UPLOAD_SIZE || 100) * 1024 * 1024 // MB to bytes
  },
  fileFilter: fileFilter
});

// 生产环境建议启用严格模式
if (process.env.NODE_ENV === 'production' && process.env.FILE_VALIDATION_STRICT !== 'true') {
  console.warn('⚠️  Production mode: Consider setting FILE_VALIDATION_STRICT=true for file upload security.');
}

// 静态文件服务（前端）
const frontendPath = join(__dirname, '../../');
app.use(express.static(frontendPath));

// ==================== API 路由 ====================

app.get('/api/health', (req, res) => {
  const isDev = process.env.NODE_ENV !== 'production';

  res.json({
    status: 'ok',
    timestamp: Date.now(),
    mode: process.env.DEPLOYMENT_MODE || 'docker',
    version: '1.0.0',
    // 开发环境返回详细信息，生产环境仅返回状态
    ...(isDev ? {
      csp: {
        enabled: cspEnabled,
        deploymentMode,
        allowInline,
        header: cspEnabled ? buildCspHeader(cspDirectives) : null,
      },
    } : {
      csp: { enabled: cspEnabled }
    }),
  });
});

// 认证路由
app.use('/api/auth', authRoutes);

// OCR 代理路由（替换 CF Workers）- 添加文件上传中间件
app.use('/api/ocr', upload.single('file'), ocrRoutes);

// 翻译相关路由
app.use('/api/translation', translationRoutes);

// 文档管理路由
app.use('/api/documents', documentRoutes);

// 用户设置路由
app.use('/api/user', userRoutes);

// 管理员路由
app.use('/api/admin', adminRoutes);
// 术语库路由（与 Next.js app/api/glossary 对齐）
app.use('/api/glossary', glossaryRoutes);

// 聊天历史路由
app.use('/api/chat', chatRoutes);

// 文献引用路由
app.use('/api/references', referenceRoutes);

// Prompt Pool 路由
app.use('/api/prompt-pool', promptPoolRoutes);

// ==================== 前端路由（SPA） ====================

// 管理员面板
app.get('/admin*', (req, res) => {
  res.sendFile(join(frontendPath, 'admin/index.html'));
});

// 主应用
app.get('*', (req, res) => {
  res.sendFile(join(frontendPath, 'index.html'));
});

// ==================== 错误处理 ====================

app.use(notFound);
app.use(errorHandler);

// ==================== 启动服务器 ====================

app.listen(PORT, async () => {
  console.log(`
╔═══════════════════════════════════════╗
║   Paper Burner X Server Started      ║
╠═══════════════════════════════════════╣
║  Port: ${PORT.toString().padEnd(29)} ║
║  Mode: ${(process.env.NODE_ENV || 'development').padEnd(29)} ║
║  Database: ${(process.env.DATABASE_URL ? 'Connected' : 'Not configured').padEnd(23)} ║
╚═══════════════════════════════════════╝
  `);

  // 初始化管理员账户
  try {
    await initializeAdmin();
  } catch (error) {
    console.error('Failed to initialize admin:', error.message);
  }
});

export default app;
