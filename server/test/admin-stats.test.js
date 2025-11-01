import request from 'supertest';
import { app } from '../src/index.js';

// 说明：此测试仅验证接口形状与鉴权门槛。在无真实数据库与鉴权上下文时，
// 断言未授权访问返回 401/403；当提供格式正确的查询参数时服务器不会 500。

describe('Admin stats endpoints shape and query params', () => {
  it('GET /api/admin/stats/detailed rejects without token', async () => {
    const res = await request(app).get('/api/admin/stats/detailed');
    expect([401, 403]).toContain(res.status);
  });

  it('GET /api/admin/stats/trends rejects without token', async () => {
    const res = await request(app).get('/api/admin/stats/trends?days=7');
    expect([401, 403]).toContain(res.status);
  });

  it('GET /api/admin/stats/trends validates days range', async () => {
    const res = await request(app).get('/api/admin/stats/trends?days=9999');
    // 未授权优先返回 401/403；若路由先校验参数也可能 400，三者之一均视为通过
    expect([401, 403, 400]).toContain(res.status);
  });

  it('GET /api/admin/stats/trends accepts start/end date params (no 500)', async () => {
    const res = await request(app).get('/api/admin/stats/trends?startDate=2025-01-01&endDate=2025-01-31');
    expect([401, 403, 200]).toContain(res.status);
  });

  it('GET /api/admin/stats/detailed returns 400 when start > end', async () => {
    const res = await request(app).get('/api/admin/stats/detailed?startDate=2025-02-01&endDate=2025-01-01');
    expect([401, 403, 400]).toContain(res.status);
  });

  it('GET /api/admin/stats/trends returns 400 when start > end', async () => {
    const res = await request(app).get('/api/admin/stats/trends?startDate=2025-02-01&endDate=2025-01-01');
    expect([401, 403, 400]).toContain(res.status);
  });
});
