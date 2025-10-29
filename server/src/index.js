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

// Helmet v8 使用驼峰指令名（camelCase）。
// 为兼容现有页面，暂时允许内联脚本与常用 CDN；后续建议改为外部文件 + nonce。
const cspDirectives = {
  defaultSrc: ["'self'"],
  scriptSrc: [
    "'self'",
    "'unsafe-inline'",
    'https://cdn.tailwindcss.com',
    'https://cdn.jsdelivr.net',
    'https://gcore.jsdelivr.net',
    'https://cdnjs.cloudflare.com',
    'https://unpkg.com',
  ],
  // 明确元素级脚本与内联事件来源
  scriptSrcElem: [
    "'self'",
    "'unsafe-inline'",
    'https://cdn.tailwindcss.com',
    'https://cdn.jsdelivr.net',
    'https://gcore.jsdelivr.net',
    'https://cdnjs.cloudflare.com',
    'https://unpkg.com',
  ],
  scriptSrcAttr: ["'self'", "'unsafe-inline'"],
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
  fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
  // 前后端同源调用；如需跨域可按需补充具体域名
  connectSrc: ["'self'"],
};

app.use(helmet({
  contentSecurityPolicy: disableCSP
    ? false
    : (isProd ? { useDefaults: false, directives: cspDirectives } : false),
}));

// CORS 配置
const corsOptions = {
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true,
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
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: parseInt(process.env.MAX_UPLOAD_SIZE || 100) * 1024 * 1024 // MB to bytes
  }
});

// 静态文件服务（前端）
const frontendPath = join(__dirname, '../../');
app.use(express.static(frontendPath));

// ==================== API 路由 ====================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: Date.now(),
    mode: process.env.DEPLOYMENT_MODE || 'docker',
    version: '1.0.0'
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
