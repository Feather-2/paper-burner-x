import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import { encrypt, decrypt } from '../utils/crypto.js';
import { AppErrors, HTTP_STATUS } from '../utils/errors.js';

const router = express.Router();

// 获取用户设置
router.get('/settings', requireAuth, async (req, res, next) => {
  try {
    const settings = await prisma.userSettings.findUnique({
      where: { userId: req.user.id }
    });

    if (!settings) {
      // 创建默认设置
      const newSettings = await prisma.userSettings.create({
        data: { userId: req.user.id }
      });
      return res.status(HTTP_STATUS.OK).json(newSettings);
    }

    res.status(HTTP_STATUS.OK).json(settings);
  } catch (error) {
    next(error);
  }
});

// 更新用户设置
router.put('/settings', requireAuth, async (req, res, next) => {
  try {
    const settings = await prisma.userSettings.upsert({
      where: { userId: req.user.id },
      update: req.body,
      create: {
        userId: req.user.id,
        ...req.body
      }
    });

    res.status(HTTP_STATUS.OK).json(settings);
  } catch (error) {
    next(error);
  }
});

// 获取 API Keys
router.get('/api-keys', requireAuth, async (req, res, next) => {
  try {
    const keys = await prisma.apiKey.findMany({
      where: { userId: req.user.id },
      orderBy: { order: 'asc' },
      select: {
        id: true,
        provider: true,
        remark: true,
        status: true,
        order: true,
        lastUsedAt: true,
        createdAt: true
        // 不返回 keyValue (已加密)
      }
    });

    res.json(keys);
  } catch (error) {
    next(error);
  }
});

// 添加 API Key
router.post('/api-keys', requireAuth, async (req, res, next) => {
  try {
    const { provider, keyValue, remark, order } = req.body;

    if (!provider || !keyValue) {
      throw AppErrors.validation('Provider and keyValue are required');
    }

    // 加密 API Key
    const encryptedKey = encrypt(keyValue);

    const key = await prisma.apiKey.create({
      data: {
        userId: req.user.id,
        provider,
        keyValue: encryptedKey,
        remark,
        order: order || 0
      }
    });

    res.status(HTTP_STATUS.CREATED).json({
      id: key.id,
      provider: key.provider,
      remark: key.remark,
      status: key.status,
      order: key.order
    });
  } catch (error) {
    next(error);
  }
});

// 获取解密的 API Key (仅用于内部使用，不暴露给前端)
// 安全考虑：不提供返回明文 Key 的接口，所有下游调用应在服务端完成并仅返回必要元数据

// 更新 API Key 状态
router.patch('/api-keys/:id/status', requireAuth, async (req, res, next) => {
  try {
    const { status } = req.body;

    if (!['VALID', 'INVALID', 'TESTING', 'UNTESTED'].includes(status)) {
      throw AppErrors.validation('Invalid status value');
    }

    await prisma.apiKey.updateMany({
      where: {
        id: req.params.id,
        userId: req.user.id
      },
      data: {
        status,
        lastUsedAt: status === 'VALID' ? new Date() : undefined
      }
    });

    res.status(HTTP_STATUS.OK).json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 删除 API Key
router.delete('/api-keys/:id', requireAuth, async (req, res, next) => {
  try {
    await prisma.apiKey.deleteMany({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    res.status(HTTP_STATUS.OK).json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 获取术语库
router.get('/glossaries', requireAuth, async (req, res, next) => {
  try {
    const glossaries = await prisma.glossary.findMany({
      where: { userId: req.user.id }
    });

    res.json(glossaries);
  } catch (error) {
    next(error);
  }
});

// 创建术语库
router.post('/glossaries', requireAuth, async (req, res, next) => {
  try {
    const { name, enabled, entries } = req.body;

    const glossary = await prisma.glossary.create({
      data: {
        userId: req.user.id,
        name,
        enabled: enabled !== undefined ? enabled : true,
        entries: entries || []
      }
    });

    res.status(HTTP_STATUS.CREATED).json(glossary);
  } catch (error) {
    next(error);
  }
});

// 更新术语库
router.put('/glossaries/:id', requireAuth, async (req, res, next) => {
  try {
    const glossary = await prisma.glossary.updateMany({
      where: {
        id: req.params.id,
        userId: req.user.id
      },
      data: req.body
    });

    res.status(HTTP_STATUS.OK).json({ success: true });
  } catch (error) {
    next(error);
  }
});

// 删除术语库
router.delete('/glossaries/:id', requireAuth, async (req, res, next) => {
  try {
    await prisma.glossary.deleteMany({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    res.status(HTTP_STATUS.OK).json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ==================== 已处理文件记录 ====================

// 获取已处理文件列表
router.get('/processed-files', requireAuth, async (req, res, next) => {
  try {
    const files = await prisma.processedFile.findMany({
      where: { userId: req.user.id },
      select: {
        fileIdentifier: true,
        fileName: true,
        processedAt: true
      }
    });

    res.json(files);
  } catch (error) {
    next(error);
  }
});

// 标记文件为已处理
router.post('/processed-files', requireAuth, async (req, res, next) => {
  try {
    const { fileIdentifier, fileName } = req.body;

    if (!fileIdentifier || !fileName) {
      throw AppErrors.validation('fileIdentifier and fileName are required');
    }

    const file = await prisma.processedFile.upsert({
      where: {
        userId_fileIdentifier: {
          userId: req.user.id,
          fileIdentifier
        }
      },
      update: {
        fileName,
        processedAt: new Date()
      },
      create: {
        userId: req.user.id,
        fileIdentifier,
        fileName
      }
    });

    res.status(HTTP_STATUS.CREATED).json(file);
  } catch (error) {
    next(error);
  }
});

// 检查文件是否已处理
router.get('/processed-files/check/:identifier', requireAuth, async (req, res, next) => {
  try {
    const file = await prisma.processedFile.findUnique({
      where: {
        userId_fileIdentifier: {
          userId: req.user.id,
          fileIdentifier: req.params.identifier
        }
      }
    });

    res.status(HTTP_STATUS.OK).json({ processed: !!file });
  } catch (error) {
    next(error);
  }
});

// 批量检查文件是否已处理
router.post('/processed-files/check-batch', requireAuth, async (req, res, next) => {
  try {
    const { identifiers } = req.body;

    if (!Array.isArray(identifiers)) {
      throw AppErrors.validation('identifiers must be an array');
    }

    const files = await prisma.processedFile.findMany({
      where: {
        userId: req.user.id,
        fileIdentifier: {
          in: identifiers
        }
      },
      select: {
        fileIdentifier: true
      }
    });

    const processedSet = new Set(files.map(f => f.fileIdentifier));
    const result = {};
    identifiers.forEach(id => {
      result[id] = processedSet.has(id);
    });

    res.status(HTTP_STATUS.OK).json(result);
  } catch (error) {
    next(error);
  }
});

// 清空已处理文件记录
router.delete('/processed-files', requireAuth, async (req, res, next) => {
  try {
    await prisma.processedFile.deleteMany({
      where: { userId: req.user.id }
    });

    res.status(HTTP_STATUS.OK).json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
