import { isMissingPathError } from "./utils.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function createStorageIO({ vfs, basePath }) {
  const snapshotsDir = `${basePath}/snapshots`;
  const checkpointsDir = `${basePath}/checkpoints`;
  const indexPath = `${basePath}/index.json`;
  const indexTmpPath = `${basePath}/index.json.tmp`;

  async function ensureDirs() {
    await vfs.mkdir(basePath, { recursive: true });
    await vfs.mkdir(snapshotsDir, { recursive: true });
    await vfs.mkdir(checkpointsDir, { recursive: true });
  }

  async function readJson(path) {
    if (typeof vfs.exists === "function") {
      const exists = await vfs.exists(path);
      if (!exists) return null;
    }

    let bytes;
    try {
      bytes = await vfs.readFile(path);
    } catch (err) {
      if (isMissingPathError(err)) return null;
      throw err;
    }

    const text = decoder.decode(bytes);
    return JSON.parse(text);
  }

  async function writeJson(path, value) {
    const json = JSON.stringify(value);
    const bytes = encoder.encode(json);
    await vfs.writeFile(path, bytes);
  }

  async function persistIndex(serialized) {
    await ensureDirs();

    const json = JSON.stringify(serialized);
    const bytes = encoder.encode(json);

    // Step 1: Write to temporary file
    await vfs.writeFile(indexTmpPath, bytes);

    // Step 2: Atomic rename if VFS supports it
    if (typeof vfs.rename === "function") {
      await vfs.rename(indexTmpPath, indexPath);
    } else {
      // Fallback: write to target, then remove temp
      await vfs.writeFile(indexPath, bytes);
      try {
        if (typeof vfs.unlink === "function") {
          await vfs.unlink(indexTmpPath);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  async function recoverTempIndexFile() {
    let tempExists = false;
    if (typeof vfs.exists === "function") {
      tempExists = await vfs.exists(indexTmpPath);
    } else {
      try {
        await vfs.readFile(indexTmpPath);
        tempExists = true;
      } catch {
        tempExists = false;
      }
    }

    if (!tempExists) return;

    let tempData = null;
    try {
      tempData = await readJson(indexTmpPath);
    } catch {
      tempData = null;
    }

    if (tempData && typeof tempData === "object") {
      if (typeof vfs.rename === "function") {
        await vfs.rename(indexTmpPath, indexPath);
      } else {
        const json = JSON.stringify(tempData);
        const bytes = encoder.encode(json);
        await vfs.writeFile(indexPath, bytes);
        try {
          if (typeof vfs.unlink === "function") {
            await vfs.unlink(indexTmpPath);
          }
        } catch {
          // Ignore cleanup errors
        }
      }
    } else {
      try {
        if (typeof vfs.unlink === "function") {
          await vfs.unlink(indexTmpPath);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  async function readIndexRaw() {
    await ensureDirs();
    await recoverTempIndexFile();
    return await readJson(indexPath);
  }

  function snapshotPath(id) {
    return `${snapshotsDir}/${id}.json`;
  }

  function checkpointPath(id) {
    return `${checkpointsDir}/${id}.json`;
  }

  return {
    ensureDirs,
    readJson,
    writeJson,
    persistIndex,
    readIndexRaw,
    snapshotPath,
    checkpointPath,
    snapshotsDir,
    checkpointsDir,
    indexPath,
    indexTmpPath,
  };
}
