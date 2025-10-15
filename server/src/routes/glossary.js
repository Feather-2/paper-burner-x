import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const router = express.Router();

// Resolve project root and data dir (two levels up from server/src)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const GLOSSARY_DATA_DIR = join(__dirname, '../../data/glossary');

async function ensureDataDir() {
  try {
    await fs.mkdir(GLOSSARY_DATA_DIR, { recursive: true });
  } catch (err) {
    // Log once; do not throw to avoid breaking health checks
    console.error('[Glossary] Failed to ensure data dir:', err);
  }
}

async function loadAllGlossarySets() {
  await ensureDataDir();
  try {
    const files = await fs.readdir(GLOSSARY_DATA_DIR);
    const sets = {};
    for (const file of files) {
      if (file.startsWith('set_') && file.endsWith('.json')) {
        const setId = file.slice(4, -5);
        const filePath = join(GLOSSARY_DATA_DIR, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const data = JSON.parse(content);
        if (data && data.set && data.set.id) {
          sets[data.set.id] = data.set;
        } else if (setId) {
          sets[setId] = data.set || { id: setId };
        }
      }
    }
    return sets;
  } catch (err) {
    console.error('[Glossary] Failed to load sets:', err);
    return {};
  }
}

async function saveGlossarySet(setId, set, entries = []) {
  await ensureDataDir();
  const filePath = join(GLOSSARY_DATA_DIR, `set_${setId}.json`);
  const payload = {
    set,
    entries,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
}

async function deleteGlossarySet(setId) {
  const filePath = join(GLOSSARY_DATA_DIR, `set_${setId}.json`);
  try {
    await fs.unlink(filePath);
  } catch (err) {
    // Ignore if not exists; log others
    if (err && err.code !== 'ENOENT') {
      console.error('[Glossary] Failed to delete set:', err);
    }
  }
}

async function loadEntriesForSet(setId) {
  const filePath = join(GLOSSARY_DATA_DIR, `set_${setId}.json`);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    return Array.isArray(data.entries) ? data.entries : [];
  } catch (err) {
    if (err && err.code !== 'ENOENT') {
      console.error('[Glossary] Failed to load entries:', err);
    }
    return [];
  }
}

// GET /api/glossary/health
router.get('/health', async (_req, res) => {
  res.json({ status: 'ok', service: 'glossary-api', timestamp: new Date().toISOString() });
});

// GET /api/glossary/sets
router.get('/sets', async (_req, res) => {
  try {
    const sets = await loadAllGlossarySets();
    res.json({ success: true, sets });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to load glossary sets' });
  }
});

// PUT /api/glossary/sets/:setId
router.put('/sets/:setId', async (req, res) => {
  try {
    const { setId } = req.params;
    const { set, entries } = req.body || {};
    if (!set || !set.id || set.id !== setId) {
      return res.status(400).json({ success: false, error: 'Invalid set data or ID mismatch' });
    }
    await saveGlossarySet(setId, set, Array.isArray(entries) ? entries : []);
    res.json({ success: true, message: 'Glossary set saved successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to save glossary set' });
  }
});

// DELETE /api/glossary/sets/:setId
router.delete('/sets/:setId', async (req, res) => {
  try {
    const { setId } = req.params;
    await deleteGlossarySet(setId);
    res.json({ success: true, message: 'Glossary set deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to delete glossary set' });
  }
});

// GET /api/glossary/sets/:setId/entries
router.get('/sets/:setId/entries', async (req, res) => {
  try {
    const { setId } = req.params;
    const entries = await loadEntriesForSet(setId);
    res.json({ success: true, entries });
  } catch (err) {
    res.status(500).json({ success: false, error: err?.message || 'Failed to load entries' });
  }
});

export default router;

