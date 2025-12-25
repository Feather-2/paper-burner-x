import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

/**
 * 术语库数据存储路径
 */
const GLOSSARY_DATA_DIR = path.join(process.cwd(), 'data', 'glossary');

/**
 * 加载指定术语库的条目
 */
async function loadEntriesForSet(setId: string) {
  const filePath = path.join(GLOSSARY_DATA_DIR, `set_${setId}.json`);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    return data.entries || [];
  } catch (err) {
    console.error('Failed to load entries for set:', err);
    return [];
  }
}

/**
 * GET /api/glossary/sets/[setId]/entries - 获取指定术语库的条目
 */
export async function GET(
  request: Request,
  { params }: { params: { setId: string } }
) {
  try {
    const { setId } = params;
    const entries = await loadEntriesForSet(setId);

    return NextResponse.json({
      success: true,
      entries
    });
  } catch (err: any) {
    console.error('Failed to load entries:', err);
    return NextResponse.json(
      {
        success: false,
        error: err.message || 'Failed to load entries'
      },
      { status: 500 }
    );
  }
}
