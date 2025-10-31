import express from 'express';
import bcrypt from 'bcryptjs';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { adminWriteLimiter } from '../middleware/rateLimit.js';
import { getProxySettingsDetailed, invalidateAllConfigCache } from '../utils/configCenter.js';
import { AppErrors, HTTP_STATUS } from '../utils/errors.js';
import { CRYPTO, ROLES, PAGINATION } from '../utils/constants.js';
import { prisma } from '../utils/prisma.js';
import { validateEmail, sanitizeSearchString, validateDate, validateUUID } from '../utils/validation.js';

const router = express.Router();

// 允许排序的字段白名单（防止 SQL 注入）
const ALLOWED_SORT_FIELDS = ['createdAt', 'email', 'name', 'role', 'isActive'];

// 验证排序字段
function validateSortField(field) {
  return ALLOWED_SORT_FIELDS.includes(field) ? field : 'createdAt';
}

// 验证排序方向
function validateSortOrder(order) {
  const orderLower = String(order).toLowerCase();
  return orderLower === 'asc' ? 'asc' : 'desc';
}

// 所有管理员路由都需要管理员权限
router.use(requireAuth, requireAdmin);

// 获取所有用户
router.get('/users', async (req, res, next) => {
  try {
    const { page = PAGINATION.DEFAULT_PAGE, pageSize = PAGINATION.DEFAULT_LIMIT, search = '', sort = 'createdAt', order = 'desc' } = req.query;

    // 验证和规范化参数
    const p = Math.max(parseInt(page) || PAGINATION.DEFAULT_PAGE, 1);
    const ps = Math.min(Math.max(parseInt(pageSize) || PAGINATION.DEFAULT_LIMIT, 1), PAGINATION.MAX_LIMIT);
    const sortField = validateSortField(String(sort));
    const sortOrder = validateSortOrder(order);

    // 限制搜索字符串长度，防止过长的查询
    const searchStr = sanitizeSearchString(search, 100);

    const where = searchStr
      ? {
          OR: [
            { email: { contains: searchStr, mode: 'insensitive' } },
            { name: { contains: searchStr, mode: 'insensitive' } }
          ]
        }
      : {};

    const [total, items] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
        orderBy: { [sortField]: sortOrder },
        skip: (p - 1) * ps,
        take: ps
      })
    ]);

    res.status(HTTP_STATUS.OK).json({ total, page: p, pageSize: ps, items });
  } catch (error) {
    next(error);
  }
});

// 创建用户（管理员）
router.post('/users', adminWriteLimiter, async (req, res, next) => {
  try {
    const { email, name = '', role = ROLES.USER, password } = req.body || {};

    // 输入验证
    if (!email || typeof email !== 'string') {
      throw AppErrors.validation('Email is required');
    }

    if (!validateEmail(email)) {
      throw AppErrors.validation('Invalid email format');
    }

    if (![ROLES.USER, ROLES.ADMIN].includes(role)) {
      throw AppErrors.validation('Invalid role');
    }

    const pwd = typeof password === 'string' && password.length >= 8
      ? password
      : Math.random().toString(36).slice(2, 10) + 'A1!';

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw AppErrors.conflict('User already exists');
    }

    const hashed = await bcrypt.hash(pwd, CRYPTO.BCRYPT_ROUNDS);
    const user = await prisma.user.create({
      data: { email, name, role, password: hashed, isActive: true }
    });
    await prisma.userSettings.create({ data: { userId: user.id } });

    try {
      await prisma.usageLog.create({
        data: { userId: req.user.id, action: 'admin_create_user', resourceId: user.id, metadata: { email, role } }
      });
    } catch {}

    res.status(HTTP_STATUS.CREATED).json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      tempPassword: password ? undefined : pwd
    });
  } catch (error) {
    next(error);
  }
});

// 编辑用户（邮箱/姓名/角色）
router.put('/users/:id', adminWriteLimiter, async (req, res, next) => {
  try {
    const { email, name, role } = req.body || {};
    const userId = req.params.id;

    if (!validateUUID(userId)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid user id' });
    }

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) {
      throw AppErrors.notFound('User');
    }

    if (role && role !== ROLES.ADMIN && target.role === ROLES.ADMIN) {
      const adminCount = await prisma.user.count({ where: { role: ROLES.ADMIN, isActive: true } });
      if (adminCount <= 1) {
        throw AppErrors.validation('Cannot demote the last active admin');
      }
    }

    const data = {};
    if (typeof email === 'string' && email) {
      if (!validateEmail(email)) {
        throw AppErrors.validation('Invalid email format');
      }
      data.email = email;
    }
    if (typeof name === 'string') data.name = name;
    if (role && [ROLES.USER, ROLES.ADMIN].includes(role)) data.role = role;

    if (Object.keys(data).length === 0) {
      return res.status(HTTP_STATUS.OK).json({ success: true });
    }

    await prisma.user.update({ where: { id: userId }, data });
    try {
      await prisma.usageLog.create({
        data: { userId: req.user.id, action: 'admin_update_user', resourceId: userId, metadata: data }
      });
    } catch {}

    res.status(HTTP_STATUS.OK).json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 更新用户状态
router.put('/users/:id/status', adminWriteLimiter, async (req, res, next) => {
  try {
    const { isActive } = req.body;
    const userId = req.params.id;

    if (!validateUUID(userId)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid user id' });
    }

    if (typeof isActive !== 'boolean') {
      throw AppErrors.validation('isActive must be a boolean');
    }

    const target = await prisma.user.findUnique({ where: { id: userId } });
    if (!target) {
      throw AppErrors.notFound('User');
    }

    if (target.role === ROLES.ADMIN && isActive === false) {
      const adminCount = await prisma.user.count({ where: { role: ROLES.ADMIN, isActive: true } });
      if (adminCount <= 1) {
        throw AppErrors.validation('Cannot disable the last active admin');
      }
    }

    await prisma.user.update({ where: { id: userId }, data: { isActive: !!isActive } });
    try {
      await prisma.usageLog.create({
        data: { userId: req.user.id, action: 'admin_update_user_status', resourceId: userId, metadata: { isActive: !!isActive } }
      });
    } catch {}

    res.status(HTTP_STATUS.OK).json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 重置用户密码
router.put('/users/:id/password', adminWriteLimiter, async (req, res, next) => {
  try {
    const userId = req.params.id;
    if (!validateUUID(userId)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid user id' });
    }
    const { password } = req.body || {};

    if (typeof password !== 'string' || password.length < 8) {
      throw AppErrors.validation('Password must be at least 8 characters');
    }

    const hashed = await bcrypt.hash(password, CRYPTO.BCRYPT_ROUNDS);
    await prisma.user.update({ where: { id: userId }, data: { password: hashed } });
    try {
      await prisma.usageLog.create({
        data: { userId: req.user.id, action: 'admin_reset_password', resourceId: userId }
      });
    } catch {}

    res.status(HTTP_STATUS.OK).json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 删除用户（保护最后一个管理员）
router.delete('/users/:id', adminWriteLimiter, async (req, res, next) => {
  try {
    const userId = req.params.id;
    if (!validateUUID(userId)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid user id' });
    }
    const target = await prisma.user.findUnique({ where: { id: userId } });

    if (!target) {
      throw AppErrors.notFound('User');
    }

    if (target.role === ROLES.ADMIN) {
      const adminCount = await prisma.user.count({ where: { role: ROLES.ADMIN, isActive: true } });
      if (adminCount <= 1) {
        throw AppErrors.validation('Cannot delete the last active admin');
      }
    }

    await prisma.user.delete({ where: { id: userId } });
    try {
      await prisma.usageLog.create({
        data: { userId: req.user.id, action: 'admin_delete_user', resourceId: userId }
      });
    } catch {}

    res.status(HTTP_STATUS.OK).json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 获取系统统计
router.get('/stats', async (req, res, next) => {
  try {
    const [
      totalUsers,
      totalDocuments,
      documentsToday,
      activeUsers
    ] = await Promise.all([
      prisma.user.count(),
      prisma.document.count(),
      prisma.document.count({
        where: {
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0))
          }
        }
      }),
      prisma.user.count({
        where: { isActive: true }
      })
    ]);

    res.status(HTTP_STATUS.OK).json({
      totalUsers,
      totalDocuments,
      documentsToday,
      activeUsers
    });
  } catch (error) {
    next(error);
  }
});

// 获取系统配置（敏感掩码）
router.get('/config', async (req, res, next) => {
  try {
    const configs = await prisma.systemConfig.findMany();
    // 扩展敏感键掩码：匹配常见后缀
    const sensitiveKeys = new Set(['JWT_SECRET', 'ENCRYPTION_SECRET']);
    const configMap = {};
    configs.forEach(c => {
      const k = c.key || '';
      const isSensitive = sensitiveKeys.has(k) || /(_SECRET|_TOKEN|_KEY)$/i.test(k);
      configMap[k] = isSensitive ? '********' : c.value;
    });
    res.status(HTTP_STATUS.OK).json(configMap);
  } catch (error) {
    next(error);
  }
});

// 更新系统配置（白名单）
router.put('/config', adminWriteLimiter, async (req, res, next) => {
  try {
    const { key, value, description } = req.body || {};
    // 扩展白名单：加入代理相关配置键，便于动态管理 OCR 代理白名单/限额/超时
    const allowList = new Set([
      'SITE_NAME',
      'ALLOW_REGISTRATION',
      'MAX_UPLOAD_SIZE_MB',
      'ENFORCE_2FA',
      'FRONTEND_CDN_MODE',
      // 新增：代理安全相关配置
      'PROXY_WHITELIST_DOMAINS',
      'ALLOW_HTTP_PROXY',
      'OCR_UPSTREAM_TIMEOUT_MS',
      'MAX_PROXY_DOWNLOAD_MB',
    ]);
    if (!key || !allowList.has(key)) return res.status(400).json({ error: 'Invalid config key' });

    // 基本类型/范围校验
    const validators = {
      'ALLOW_HTTP_PROXY': v => ['true','false'].includes(String(v).toLowerCase()),
      'OCR_UPSTREAM_TIMEOUT_MS': v => !isNaN(parseInt(v)) && parseInt(v) >= 1000 && parseInt(v) <= 300000,
      'MAX_PROXY_DOWNLOAD_MB': v => !isNaN(parseInt(v)) && parseInt(v) >= 1 && parseInt(v) <= 2048,
      'PROXY_WHITELIST_DOMAINS': v => typeof v === 'string' && v.length <= 2000,
      'WORKER_PROXY_DOMAINS': v => typeof v === 'string' && v.length <= 2000,
      'MAX_UPLOAD_SIZE_MB': v => !isNaN(parseInt(v)) && parseInt(v) >= 1 && parseInt(v) <= 2048,
      'ALLOW_REGISTRATION': v => ['true','false'].includes(String(v).toLowerCase()),
    };
    if (validators[key] && !validators[key](value)) {
      return res.status(400).json({ error: `Invalid value for ${key}` });
    }
    await prisma.systemConfig.upsert({
      where: { key },
      update: { value, description },
      create: { key, value, description }
    });
    try { await prisma.usageLog.create({ data: { userId: req.user.id, action: 'admin_update_config', resourceId: key, metadata: { valueChanged: true } } }); } catch {}
    res.status(HTTP_STATUS.OK).json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 获取当前生效的代理设置（合并后 + 来源拆解）
router.get('/proxy-settings/effective', async (req, res, next) => {
  try {
    const detailed = await getProxySettingsDetailed();
    res.status(HTTP_STATUS.OK).json(detailed);
  } catch (error) {
    next(error);
  }
});

// 立即应用配置（清空配置缓存，强制下次读取 DB）
router.post('/proxy-settings/apply-now', adminWriteLimiter, async (req, res, next) => {
  try {
    invalidateAllConfigCache();
    res.status(HTTP_STATUS.OK).json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 全局自定义源站管理
router.get('/source-sites', async (req, res, next) => {
  try {
    const sites = await prisma.customSourceSite.findMany({
      where: { userId: null } // 全局配置
    });

    res.status(HTTP_STATUS.OK).json(sites);
  } catch (error) {
    next(error);
  }
});

router.post('/source-sites', adminWriteLimiter, async (req, res, next) => {
  try {
    const { displayName, apiBaseUrl, requestFormat = 'openai', temperature = 0.5, maxTokens = 8000, availableModels = [] } = req.body || {};

    if (!displayName || typeof displayName !== 'string') throw AppErrors.validation('displayName is required');
    if (!apiBaseUrl || typeof apiBaseUrl !== 'string' || !/^https?:\/\//i.test(apiBaseUrl)) throw AppErrors.validation('apiBaseUrl must be a valid URL');
    if (!['openai','anthropic','custom'].includes(requestFormat)) throw AppErrors.validation('requestFormat invalid');
    const tempNum = Number(temperature); if (Number.isNaN(tempNum) || tempNum < 0 || tempNum > 2) throw AppErrors.validation('temperature must be 0~2');
    const maxTk = parseInt(maxTokens); if (Number.isNaN(maxTk) || maxTk < 1 || maxTk > 1000000) throw AppErrors.validation('maxTokens out of range');
    const models = Array.isArray(availableModels) ? availableModels.map(String).slice(0, 200) : [];

    const site = await prisma.customSourceSite.create({
      data: {
        userId: null,
        displayName,
        apiBaseUrl,
        requestFormat,
        temperature: tempNum,
        maxTokens: maxTk,
        availableModels: models,
      }
    });

    res.status(HTTP_STATUS.CREATED).json(site);
  } catch (error) {
    next(error);
  }
});

router.put('/source-sites/:id', adminWriteLimiter, async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!validateUUID(id)) return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid id' });

    const { displayName, apiBaseUrl, requestFormat, temperature, maxTokens, availableModels } = req.body || {};

    const data = {};
    if (displayName !== undefined) {
      if (!displayName || typeof displayName !== 'string') throw AppErrors.validation('displayName invalid');
      data.displayName = displayName;
    }
    if (apiBaseUrl !== undefined) {
      if (!apiBaseUrl || typeof apiBaseUrl !== 'string' || !/^https?:\/\//i.test(apiBaseUrl)) throw AppErrors.validation('apiBaseUrl invalid');
      data.apiBaseUrl = apiBaseUrl;
    }
    if (requestFormat !== undefined) {
      if (!['openai','anthropic','custom'].includes(requestFormat)) throw AppErrors.validation('requestFormat invalid');
      data.requestFormat = requestFormat;
    }
    if (temperature !== undefined) {
      const tempNum = Number(temperature); if (Number.isNaN(tempNum) || tempNum < 0 || tempNum > 2) throw AppErrors.validation('temperature must be 0~2');
      data.temperature = tempNum;
    }
    if (maxTokens !== undefined) {
      const maxTk = parseInt(maxTokens); if (Number.isNaN(maxTk) || maxTk < 1 || maxTk > 1000000) throw AppErrors.validation('maxTokens out of range');
      data.maxTokens = maxTk;
    }
    if (availableModels !== undefined) {
      const models = Array.isArray(availableModels) ? availableModels.map(String).slice(0, 200) : [];
      data.availableModels = models;
    }

    if (Object.keys(data).length === 0) return res.status(HTTP_STATUS.OK).json({ success: true });

    await prisma.customSourceSite.update({ where: { id }, data });

    res.status(HTTP_STATUS.OK).json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.delete('/source-sites/:id', adminWriteLimiter, async (req, res, next) => {
  try {
    const id = req.params.id;
    if (!validateUUID(id)) return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid id' });

    await prisma.customSourceSite.delete({ where: { id } });

    res.status(HTTP_STATUS.OK).json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ==================== 用户配额管理 ====================

// 获取用户配额
router.get('/users/:userId/quota', async (req, res, next) => {
  try {
    const userId = req.params.userId;
    if (!validateUUID(userId)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid user id' });
    }

    let quota = await prisma.userQuota.findUnique({
      where: { userId }
    });

    if (!quota) {
      // 创建默认配额
      quota = await prisma.userQuota.create({
        data: { userId }
      });
    }

    res.status(HTTP_STATUS.OK).json(quota);
  } catch (error) {
    next(error);
  }
});

// 更新用户配额
router.put('/users/:userId/quota', async (req, res, next) => {
  try {
    const userId = req.params.userId;
    if (!validateUUID(userId)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid user id' });
    }

    const quota = await prisma.userQuota.upsert({
      where: { userId },
      update: req.body,
      create: {
        userId,
        ...req.body
      }
    });

    res.status(HTTP_STATUS.OK).json(quota);
  } catch (error) {
    next(error);
  }
});

// ==================== 高级统计 ====================

// 获取详细的系统统计
router.get('/stats/detailed', async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;

    // 基础统计（可以根据日期范围过滤）
    const [
      totalUsers,
      activeUsers,
      totalDocuments,
      totalStorage,
      documentsToday,
      documentsThisWeek,
      documentsThisMonth
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.document.count(),
      prisma.document.aggregate({
        _sum: { fileSize: true }
      }),
      prisma.document.count({
        where: {
          createdAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0))
          }
        }
      }),
      prisma.document.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          }
        }
      }),
      prisma.document.count({
        where: {
          createdAt: {
            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
          }
        }
      })
    ]);

    // 按状态统计文档
    const documentsByStatus = await prisma.document.groupBy({
      by: ['status'],
      _count: true
    });

    // 最活跃的用户（本月）
    const topUsers = await prisma.document.groupBy({
      by: ['userId'],
      _count: true,
      where: {
        createdAt: {
          gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
        }
      },
      orderBy: {
        _count: {
          userId: 'desc'
        }
      },
      take: 10
    });

    // 获取用户详细信息
    const topUsersDetails = await Promise.all(
      topUsers.map(async (u) => {
        const user = await prisma.user.findUnique({
          where: { id: u.userId },
          select: { id: true, email: true, name: true }
        });
        return {
          ...user,
          documentCount: u._count
        };
      })
    );

    res.status(HTTP_STATUS.OK).json({
      basic: {
        totalUsers,
        activeUsers,
        totalDocuments,
        totalStorageMB: Math.round((totalStorage._sum.fileSize || 0) / 1024 / 1024),
        documentsToday,
        documentsThisWeek,
        documentsThisMonth
      },
      documentsByStatus: documentsByStatus.map(d => ({
        status: d.status,
        count: d._count
      })),
      topUsers: topUsersDetails
    });
  } catch (error) {
    next(error);
  }
});

// 获取使用趋势
router.get('/stats/trends', async (req, res, next) => {
  try {
    const { days = 30 } = req.query;

    // 验证 days 参数
    const daysNum = parseInt(days);
    if (isNaN(daysNum) || daysNum < 1 || daysNum > 365) {
      throw AppErrors.validation('days must be between 1 and 365');
    }

    const startDate = new Date(Date.now() - daysNum * 24 * 60 * 60 * 1000);

    // 按天统计文档创建数
    const documents = await prisma.document.findMany({
      where: {
        createdAt: { gte: startDate }
      },
      select: {
        createdAt: true,
        status: true
      }
    });

    // 按天分组
    const trendMap = {};
    documents.forEach(doc => {
      const date = doc.createdAt.toISOString().split('T')[0];
      if (!trendMap[date]) {
        trendMap[date] = { date, total: 0, completed: 0, failed: 0 };
      }
      trendMap[date].total++;
      if (doc.status === 'COMPLETED') trendMap[date].completed++;
      if (doc.status === 'FAILED') trendMap[date].failed++;
    });

    const trends = Object.values(trendMap).sort((a, b) =>
      new Date(a.date) - new Date(b.date)
    );

    res.status(HTTP_STATUS.OK).json(trends);
  } catch (error) {
    next(error);
  }
});

// 用户活动日志
router.get('/users/:userId/activity', async (req, res, next) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const userId = req.params.userId;
    if (!validateUUID(userId)) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Invalid user id' });
    }

    // 验证参数
    const limitNum = Math.min(Math.max(parseInt(limit) || 50, 1), 200);
    const offsetNum = Math.max(parseInt(offset) || 0, 0);

    const logs = await prisma.usageLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limitNum,
      skip: offsetNum
    });

    res.status(HTTP_STATUS.OK).json(logs);
  } catch (error) {
    next(error);
  }
});

export default router;
