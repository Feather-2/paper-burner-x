import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import { AppErrors, HTTP_STATUS } from '../utils/errors.js';

const router = express.Router();

// 限制数组大小
const MAX_PROMPTS_ARRAY_SIZE = 1000;

// 获取用户的 Prompt Pool
router.get('/', requireAuth, async (req, res, next) => {
  try {
    const promptPool = await prisma.promptPool.findUnique({
      where: { userId: req.user.id }
    });

    if (!promptPool) {
      // 返回默认空结构
      return res.status(HTTP_STATUS.OK).json({
        prompts: [],
        healthConfig: null
      });
    }

    res.status(HTTP_STATUS.OK).json({
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

    // 输入验证
    if (!Array.isArray(prompts)) {
      throw AppErrors.validation('prompts must be an array');
    }

    // 限制数组大小
    if (prompts.length > MAX_PROMPTS_ARRAY_SIZE) {
      throw AppErrors.validation(`Too many prompts (max ${MAX_PROMPTS_ARRAY_SIZE})`);
    }

    // 验证每个 prompt 的基本格式（但保持宽松，不强制要求所有字段）
    const validPrompts = prompts.filter(prompt => {
      return prompt && typeof prompt === 'object';
    });

    if (validPrompts.length !== prompts.length) {
      throw AppErrors.validation('Some prompts have invalid format');
    }

    const promptPool = await prisma.promptPool.upsert({
      where: { userId: req.user.id },
      update: {
        prompts: validPrompts,
        healthConfig
      },
      create: {
        userId: req.user.id,
        prompts: validPrompts,
        healthConfig
      }
    });

    res.status(HTTP_STATUS.OK).json({
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

    // 输入验证
    if (!newPrompt || typeof newPrompt !== 'object') {
      throw AppErrors.validation('Prompt must be an object');
    }

    // 获取当前 Prompt Pool
    let promptPool = await prisma.promptPool.findUnique({
      where: { userId: req.user.id }
    });

    let prompts = promptPool ? (promptPool.prompts || []) : [];

    // 限制数组大小
    if (prompts.length >= MAX_PROMPTS_ARRAY_SIZE) {
      throw AppErrors.validation(`Maximum number of prompts reached (${MAX_PROMPTS_ARRAY_SIZE})`);
    }

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

    res.status(HTTP_STATUS.CREATED).json({
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
      throw AppErrors.notFound('Prompt pool');
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
        throw AppErrors.notFound('Prompt');
      }
    }

    // 更新
    const updated = await prisma.promptPool.update({
      where: { userId: req.user.id },
      data: { prompts }
    });

    res.status(HTTP_STATUS.OK).json({
      prompts: updated.prompts,
      healthConfig: updated.healthConfig
    });
  } catch (error) {
    next(error);
  }
});

export default router;
