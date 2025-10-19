import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { PrismaClient } from '@prisma/client';

const router = express.Router();
const prisma = new PrismaClient();

// 获取文档的聊天历史
router.get('/:documentId/history', requireAuth, async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const { limit = 100, before } = req.query;

    // 验证文档所有权
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        userId: req.user.id
      }
    });

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // 构建查询条件
    const where = {
      documentId,
      userId: req.user.id
    };

    if (before) {
      where.timestamp = { lt: new Date(before) };
    }

    // 获取消息
    const messages = await prisma.chatMessage.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: parseInt(limit),
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

    res.json({
      messages: sortedMessages,
      hasMore: messages.length === parseInt(limit)
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

    if (!role || !content) {
      return res.status(400).json({ error: 'Role and content are required' });
    }

    if (!['user', 'assistant'].includes(role)) {
      return res.status(400).json({ error: 'Role must be "user" or "assistant"' });
    }

    // 验证文档所有权
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        userId: req.user.id
      }
    });

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
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

    res.status(201).json(message);
  } catch (error) {
    next(error);
  }
});

// 批量添加聊天消息（用于导入）
router.post('/:documentId/history/batch', requireAuth, async (req, res, next) => {
  try {
    const { documentId } = req.params;
    const { messages } = req.body;

    if (!Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages must be an array' });
    }

    // 验证文档所有权
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        userId: req.user.id
      }
    });

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    // 批量创建消息
    const createdMessages = await prisma.chatMessage.createMany({
      data: messages.map(msg => ({
        documentId,
        userId: req.user.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp ? new Date(msg.timestamp) : undefined,
        metadata: msg.metadata
      })),
      skipDuplicates: true
    });

    res.status(201).json({
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

    // 验证文档所有权
    const document = await prisma.document.findFirst({
      where: {
        id: documentId,
        userId: req.user.id
      }
    });

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    await prisma.chatMessage.deleteMany({
      where: {
        documentId,
        userId: req.user.id
      }
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
