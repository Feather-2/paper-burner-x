import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

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
      return res.json(newSettings);
    }

    res.json(settings);
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

    res.json(settings);
  } catch (error) {
    next(error);
  }
});

// 获取 API Keys
router.get('/api-keys', requireAuth, async (req, res, next) => {
  try {
    const keys = await prisma.apiKey.findMany({
      where: { userId: req.user.id },
      select: {
        id: true,
        provider: true,
        remark: true,
        status: true,
        order: true,
        lastUsedAt: true,
        createdAt: true
        // 不返回 keyValue
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
      return res.status(400).json({ error: 'Provider and keyValue are required' });
    }

    const key = await prisma.apiKey.create({
      data: {
        userId: req.user.id,
        provider,
        keyValue, // 在生产环境应加密
        remark,
        order: order || 0
      }
    });

    res.status(201).json({
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

// 删除 API Key
router.delete('/api-keys/:id', requireAuth, async (req, res, next) => {
  try {
    await prisma.apiKey.deleteMany({
      where: {
        id: req.params.id,
        userId: req.user.id
      }
    });

    res.json({ success: true });
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

    res.status(201).json(glossary);
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

    res.json({ success: true });
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

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
