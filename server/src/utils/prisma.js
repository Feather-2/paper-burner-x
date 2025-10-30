import { PrismaClient } from '@prisma/client';

/**
 * PrismaClient 单例模式
 * 避免多个实例导致数据库连接泄漏
 *
 * 根据 Prisma 最佳实践：
 * - 在开发环境中，PrismaClient 实例会在代码更改时重新创建
 * - 在生产环境中，应该重用同一个实例
 */
let prismaInstance = null;

/**
 * 获取 PrismaClient 单例
 * @returns {PrismaClient} PrismaClient 实例
 */
export function getPrisma() {
  if (!prismaInstance) {
    prismaInstance = new PrismaClient({
      log: process.env.NODE_ENV === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
    });

    // 优雅关闭处理
    process.on('beforeExit', async () => {
      await prismaInstance.$disconnect();
    });
  }

  return prismaInstance;
}

// 导出单例实例（向后兼容）
export const prisma = getPrisma();

// 默认导出
export default prisma;

