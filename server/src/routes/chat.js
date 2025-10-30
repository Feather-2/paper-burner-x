import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { prisma } from '../utils/prisma.js';
import { AppErrors, HTTP_STATUS } from '../utils/errors.js';
import { PAGINATION } from '../utils/constants.js';
import { validateUUID, validateDate } from '../utils/validation.js';

const router = express.Router();

// 允许的聊天角色
const ALLOWED_ROLES = ['user', 'assistant'];

// 获取文档的聊天历史
router.get('/:documentId/history', requireAuth, async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const { limit = 100, before } = req.query;

    // 验证 UUID 格式
    if (!validateUUID(documentId)) {
      throw AppErrors.validation('Invalid document ID format');
    }

    // 验证和规范化参数
    const limitNum = Math.min(Math.max(parseInt(limit) || 100, 1), PAGINATION.MAX_LIMIT);
    const beforeDate = before ? validateDate(before) : null;

    if (before && !beforeDate) {
      throw AppErrors.validation('Invalid before date format');
    }

    // 验证文档所有权
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        userId: req.user.id
      }
    });

    if (!document) {
      throw AppErrors.notFound('Document');
    }

    // 构建查询条件
    const where = {
      documentId,
      userId: req.user.id
    };

    if (beforeDate) {
      where.timestamp = { lt: beforeDate };
    }

    // 获取消息
    const messages = await prisma.chatMessage.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limitNum,
      select: {
        id: true,
        role: true,
        content: true,
        timestamp: true,
        metadata: true
      }
    });

    // 反转顺序，使最早的消息在前
    const sortedMessages = messages.reverse();

    res.status(HTTP_STATUS.OK).json({
      messages: sortedMessages,
      hasMore: messages.length === limitNum
    });
  } catch (error) {
    next(error);
  }
});

// 添加聊天消息
router.post('/:documentId/history', requireAuth, async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const { role, content, metadata } = req.body;

    // 验证 UUID 格式
    if (!validateUUID(documentId)) {
      throw AppErrors.validation('Invalid document ID format');
    }

    // 输入验证
    if (!role || typeof role !== 'string') {
      throw AppErrors.validation('Role is required');
    }

    if (!ALLOWED_ROLES.includes(role)) {
      throw AppErrors.validation(`Role must be one of: ${ALLOWED_ROLES.join(', ')}`);
    }

    if (!content || typeof content !== 'string') {
      throw AppErrors.validation('Content is required');
    }

    // 限制内容长度（防止过大的消息）
    const maxContentLength = 100000; // 100KB
    if (content.length > maxContentLength) {
      throw AppErrors.validation(`Content too long (max ${maxContentLength} characters)`);
    }

    // 验证文档所有权
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        userId: req.user.id
      }
    });

    if (!document) {
      throw AppErrors.notFound('Document');
    }

    // 创建消息
    const message = await prisma.chatMessage.create({
      data: {
        documentId,
        userId: req.user.id,
        role,
        content,
        metadata
      }
    });

    res.status(HTTP_STATUS.CREATED).json(message);
  } catch (error) {
    next(error);
  }
});

// 批量添加聊天消息（用于导入）
router.post('/:documentId/history/batch', requireAuth, async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const { messages } = req.body;

    // 验证 UUID 格式
    if (!validateUUID(documentId)) {
      throw AppErrors.validation('Invalid document ID format');
    }

    // 输入验证
    if (!Array.isArray(messages)) {
      throw AppErrors.validation('Messages must be an array');
    }

    // 限制批量大小（防止过大的批量请求）
    const maxBatchSize = 1000;
    if (messages.length > maxBatchSize) {
      throw AppErrors.validation(`Batch size too large (max ${maxBatchSize} messages)`);
    }

    // 验证文档所有权
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        userId: req.user.id
      }
    });

    if (!document) {
      throw AppErrors.notFound('Document');
    }

    // 验证每条消息的基本格式
    const validMessages = messages.filter(msg => {
      return msg && typeof msg === 'object' &&
             ALLOWED_ROLES.includes(msg.role) &&
             typeof msg.content === 'string';
    });

    if (validMessages.length !== messages.length) {
      throw AppErrors.validation('Some messages have invalid format');
    }

    // 批量创建消息
    const createdMessages = await prisma.chatMessage.createMany({
      data: validMessages.map(msg => ({
        documentId,
        userId: req.user.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp ? validateDate(msg.timestamp) || new Date() : undefined,
        metadata: msg.metadata
      })),
      skipDuplicates: true
    });

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      count: createdMessages.count
    });
  } catch (error) {
    next(error);
  }
});

// 清空文档的聊天历史
router.delete('/:documentId/history', requireAuth, async (req, res, next) => {
  try {
    const { documentId } = req.params;

    // 验证 UUID 格式
    if (!validateUUID(documentId)) {
      throw AppErrors.validation('Invalid document ID format');
    }

    // 验证文档所有权
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        userId: req.user.id
      }
    });

    if (!document) {
      throw AppErrors.notFound('Document');
    }

    await prisma.chatMessage.deleteMany({
      where: {
        documentId,
        userId: req.user.id
      }
    });

    res.status(HTTP_STATUS.OK).json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
