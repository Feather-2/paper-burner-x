import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

/**
 * 术语库数据存储路径（使用文件系统作为简单存储）
 * 生产环境应使用数据库
 */
const GLOSSARY_DATA_DIR = path.join(process.cwd(), 'data', 'glossary');

/**
 * 确保数据目录存在
 */
async function ensureDataDir() {
  try {
    await fs.mkdir(GLOSSARY_DATA_DIR, { recursive: true });
  } catch (err) {
    console.error('Failed to create glossary data directory:', err);
  }
}

/**
 * 加载所有术语库集合
 */
async function loadAllGlossarySets() {
  await ensureDataDir();

  try {
    const files = await fs.readdir(GLOSSARY_DATA_DIR);
    const sets: Record<string, any> = {};

    for (const file of files) {
      if (file.endsWith('.json') && file.startsWith('set_')) {
        const setId = file.replace('set_', '').replace('.json', '');
        const filePath = path.join(GLOSSARY_DATA_DIR, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);
        sets[setId] = data.set;
      }
    }

    return sets;
  } catch (err) {
    console.error('Failed to load glossary sets:', err);
    return {};
  }
}

/**
 * 保存术语库集合
 */
async function saveGlossarySet(setId: string, set: any, entries: any[]) {
  await ensureDataDir();

  const filePath = path.join(GLOSSARY_DATA_DIR, `set_${setId}.json`);
  const data = {
    set,
    entries,
    updatedAt: new Date().toISOString()
  };

  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

/**
 * 删除术语库集合
 */
async function deleteGlossarySet(setId: string) {
  const filePath = path.join(GLOSSARY_DATA_DIR, `set_${setId}.json`);

  try {
    await fs.unlink(filePath);
  } catch (err) {
    console.error('Failed to delete glossary set:', err);
  }
}

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
 * GET /api/glossary/sets - 获取所有术语库集合
 */
export async function GET() {
  try {
    const sets = await loadAllGlossarySets();

    return NextResponse.json({
      success: true,
      sets
    });
  } catch (err: any) {
    console.error('Failed to get glossary sets:', err);
    return NextResponse.json(
      {
        success: false,
        error: err.message || 'Failed to load glossary sets'
      },
      { status: 500 }
    );
  }
}
