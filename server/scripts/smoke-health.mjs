import request from 'supertest';
import { app } from '../src/index.js';

async function main() {
  try {
    const health = await request(app).get('/api/health');
    console.log('HEALTH', health.status, JSON.stringify(health.body));

    const admin = await request(app).get('/admin');
    console.log('ADMIN', admin.status, admin.headers['content-type']);

    const login = await request(app).get('/login.html');
    console.log('LOGIN', login.status, login.headers['content-type']);

    if (health.status !== 200) {
      process.exitCode = 1;
    }
  } catch (err) {
    console.error('Smoke check failed:', err);
    process.exitCode = 1;
  }
}

await main();
