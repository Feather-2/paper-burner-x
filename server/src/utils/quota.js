import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * 记录用户使用量日志
 * @param {string} userId - 用户ID
 * @param {string} action - 操作类型
 * @param {string} resourceId - 资源ID（可选）
 * @param {object} metadata - 元数据（可选）
 */
export async function logUsage(userId, action, resourceId = null, metadata = null) {
  try {
    await prisma.usageLog.create({
      data: {
        userId,
        action,
        resourceId,
        metadata
      }
    });
  } catch (error) {
    console.error('Failed to log usage:', error);
    // 不抛出错误，避免影响主业务流程
  }
}

/**
 * 检查用户是否超过配额
 * @param {string} userId - 用户ID
 * @returns {Promise<{allowed: boolean, reason?: string}>}
 */
export async function checkQuota(userId) {
  try {
    const quota = await prisma.userQuota.findUnique({
      where: { userId }
    });

    // 如果没有配额设置，默认允许
    if (!quota) {
      return { allowed: true };
    }

    // 检查月度配额
    if (quota.maxDocumentsPerMonth > 0) {
      // 检查是否需要重置
      const now = new Date();
      const lastReset = new Date(quota.lastMonthlyReset);
      if (now.getMonth() !== lastReset.getMonth() || now.getFullYear() !== lastReset.getFullYear()) {
        // 重置月度计数
        await prisma.userQuota.update({
          where: { userId },
          data: {
            documentsThisMonth: 0,
            lastMonthlyReset: now
          }
        });
      } else if (quota.documentsThisMonth >= quota.maxDocumentsPerMonth) {
        return {
          allowed: false,
          reason: `Monthly document quota exceeded (${quota.maxDocumentsPerMonth} documents)`
        };
      }
    }

    // 检查存储配额
    if (quota.maxStorageSize > 0 && quota.currentStorageUsed >= quota.maxStorageSize) {
      return {
        allowed: false,
        reason: `Storage quota exceeded (${quota.maxStorageSize} MB)`
      };
    }

    return { allowed: true };
  } catch (error) {
    console.error('Failed to check quota:', error);
    // 出错时默认允许，避免影响用户体验
    return { allowed: true };
  }
}

/**
 * 增加文档计数
 * @param {string} userId - 用户ID
 * @param {number} fileSize - 文件大小（字节）
 */
export async function incrementDocumentCount(userId, fileSize = 0) {
  try {
    const fileSizeMB = Math.ceil(fileSize / 1024 / 1024);

    await prisma.userQuota.upsert({
      where: { userId },
      update: {
        documentsThisMonth: {
          increment: 1
        },
        currentStorageUsed: {
          increment: fileSizeMB
        }
      },
      create: {
        userId,
        documentsThisMonth: 1,
        currentStorageUsed: fileSizeMB
      }
    });
  } catch (error) {
    console.error('Failed to increment document count:', error);
  }
}

/**
 * 减少文档计数（删除文档时）
 * @param {string} userId - 用户ID
 * @param {number} fileSize - 文件大小（字节）
 */
export async function decrementDocumentCount(userId, fileSize = 0) {
  try {
    const fileSizeMB = Math.ceil(fileSize / 1024 / 1024);

    const quota = await prisma.userQuota.findUnique({
      where: { userId }
    });

    if (quota) {
      await prisma.userQuota.update({
        where: { userId },
        data: {
          documentsThisMonth: Math.max(0, quota.documentsThisMonth - 1),
          currentStorageUsed: Math.max(0, quota.currentStorageUsed - fileSizeMB)
        }
      });
    }
  } catch (error) {
    console.error('Failed to decrement document count:', error);
  }
}
