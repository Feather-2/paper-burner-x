import { isMissingPathError } from "./utils.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function validateStorageId(id, label) {
  const value = typeof id === "string" ? id.trim() : "";
  if (!value) throw new Error(`L3Storage requires { ${label} }`);
  if (value.includes("..") || value.includes("/") || value.includes("\\")) {
    throw new Error(`L3Storage ${label} contains invalid characters (path traversal attempt)`);
  }
  return value;
}

function validateSnapshotId(snapshotId) {
  return validateStorageId(snapshotId, "snapshotId");
}

function validateCheckpointId(checkpointId) {
  return validateStorageId(checkpointId, "checkpointId");
}

export function createStorageIO({ vfs, basePath }) {
  const snapshotsDir = `${basePath}/snapshots`;
  const checkpointsDir = `${basePath}/checkpoints`;
  const indexPath = `${basePath}/index.json`;
  const indexTmpPath = `${basePath}/index.json.tmp`;

  const isPlainObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  const isNonEmptyString = (value) => typeof value === "string" && value.trim() !== "";

  function validateJson(path, value) {
    if (path === indexPath || path === indexTmpPath) {
      if (!isPlainObject(value)) return null;
      if (value.timeline !== undefined && !Array.isArray(value.timeline)) return null;
      if (
        value.checkpointIndex !== undefined &&
        !Array.isArray(value.checkpointIndex) &&
        !Array.isArray(value.checkpoints)
      ) {
        return null;
      }
      return value;
    }

    if (path.startsWith(`${snapshotsDir}/`)) {
      if (!isPlainObject(value)) return null;
      return isNonEmptyString(value.id) ? value : null;
    }

    if (path.startsWith(`${checkpointsDir}/`)) {
      if (!isPlainObject(value)) return null;
      return isNonEmptyString(value.id) ? value : null;
    }

    return value;
  }

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
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return null;
    }
    return validateJson(path, parsed);
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
    const safeId = validateSnapshotId(id);
    return `${snapshotsDir}/${safeId}.json`;
  }

  function checkpointPath(id) {
    const safeId = validateCheckpointId(id);
    return `${checkpointsDir}/${safeId}.json`;
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
