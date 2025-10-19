import { NextResponse } from 'next/server';
import fs from 'fs/promises';
import path from 'path';

/**
 * 术语库数据存储路径
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
 * PUT /api/glossary/sets/[setId] - 保存/更新术语库集合
 */
export async function PUT(
  request: Request,
  { params }: { params: { setId: string } }
) {
  try {
    const { setId } = params;
    const body = await request.json();
    const { set, entries } = body;

    if (!set || !set.id || set.id !== setId) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid set data or ID mismatch'
        },
        { status: 400 }
      );
    }

    await saveGlossarySet(setId, set, entries || []);

    return NextResponse.json({
      success: true,
      message: 'Glossary set saved successfully'
    });
  } catch (err: any) {
    console.error('Failed to save glossary set:', err);
    return NextResponse.json(
      {
        success: false,
        error: err.message || 'Failed to save glossary set'
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/glossary/sets/[setId] - 删除术语库集合
 */
export async function DELETE(
  request: Request,
  { params }: { params: { setId: string } }
) {
  try {
    const { setId } = params;

    await deleteGlossarySet(setId);

    return NextResponse.json({
      success: true,
      message: 'Glossary set deleted successfully'
    });
  } catch (err: any) {
    console.error('Failed to delete glossary set:', err);
    return NextResponse.json(
      {
        success: false,
        error: err.message || 'Failed to delete glossary set'
      },
      { status: 500 }
    );
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
