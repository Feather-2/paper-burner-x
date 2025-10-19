import { NextResponse } from 'next/server';

/**
 * 健康检查端点 - 用于检测后端术语库 API 是否可用
 */
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'glossary-api',
    timestamp: new Date().toISOString()
  });
}
