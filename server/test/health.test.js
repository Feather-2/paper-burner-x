import request from 'supertest';
import { app } from '../src/index.js';

describe('Health endpoint', () => {
  it('GET /api/health returns ok and minimal fields', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('timestamp');
    expect(res.body).toHaveProperty('mode');
  });
});
