import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

// 获取用户的 Prompt Pool
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const promptPool = await prisma.promptPool.findUnique({
      where: { userId: req.user.id }
    });

    if (!promptPool) {
      // 返回默认空结构
      return res.json({
        prompts: [],
        healthConfig: null
      });
    }

    res.json({
      prompts: promptPool.prompts,
      healthConfig: promptPool.healthConfig
    });
  } catch (error) {
    next(error);
  }
});

// 更新 Prompt Pool（全量）
router.put('/', requireAuth, async (req, res, next) => {
  try {
    const { prompts, healthConfig } = req.body;

    if (!Array.isArray(prompts)) {
      return res.status(400).json({ error: 'prompts must be an array' });
    }

    const promptPool = await prisma.promptPool.upsert({
      where: { userId: req.user.id },
      update: {
        prompts,
        healthConfig
      },
      create: {
        userId: req.user.id,
        prompts,
        healthConfig
      }
    });

    res.json({
      prompts: promptPool.prompts,
      healthConfig: promptPool.healthConfig
    });
  } catch (error) {
    next(error);
  }
});

// 添加单个 Prompt
router.post('/prompts', requireAuth, async (req, res, next) => {
  try {
    const newPrompt = req.body;

    // 获取当前 Prompt Pool
    let promptPool = await prisma.promptPool.findUnique({
      where: { userId: req.user.id }
    });

    let prompts = promptPool ? (promptPool.prompts || []) : [];

    // 添加新 Prompt
    prompts.push(newPrompt);

    // 更新
    promptPool = await prisma.promptPool.upsert({
      where: { userId: req.user.id },
      update: { prompts },
      create: {
        userId: req.user.id,
        prompts
      }
    });

    res.status(201).json({
      prompts: promptPool.prompts,
      healthConfig: promptPool.healthConfig
    });
  } catch (error) {
    next(error);
  }
});

// 删除指定 Prompt（根据索引或 ID）
router.delete('/prompts/:identifier', requireAuth, async (req, res, next) => {
  try {
    const { identifier } = req.params;

    const promptPool = await prisma.promptPool.findUnique({
      where: { userId: req.user.id }
    });

    if (!promptPool) {
      return res.status(404).json({ error: 'Prompt pool not found' });
    }

    let prompts = promptPool.prompts || [];

    // 尝试作为索引解析
    const index = parseInt(identifier);
    if (!isNaN(index) && index >= 0 && index < prompts.length) {
      prompts.splice(index, 1);
    } else {
      // 尝试作为 ID 查找
      const initialLength = prompts.length;
      prompts = prompts.filter(p => p.id !== identifier);

      if (prompts.length === initialLength) {
        return res.status(404).json({ error: 'Prompt not found' });
      }
    }

    // 更新
    const updated = await prisma.promptPool.update({
      where: { userId: req.user.id },
      data: { prompts }
    });

    res.json({
      prompts: updated.prompts,
      healthConfig: updated.healthConfig
    });
  } catch (error) {
    next(error);
  }
});

export default router;
