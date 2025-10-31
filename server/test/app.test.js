import request from 'supertest';
import { app } from '../src/index.js';

describe('App basic routes (no DB required)', () => {
  it('serves admin page at /admin', async () => {
    const res = await request(app).get('/admin');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.text).toMatch(/管理面板|Paper Burner X/);
  });

  it('serves index at /', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
  });
});
