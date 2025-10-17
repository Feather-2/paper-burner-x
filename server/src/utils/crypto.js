import crypto from 'crypto';

/**
 * 加密工具模块
 * 用于安全地加密和解密敏感数据（如 API Keys）
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 64;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

/**
 * 从环境变量获取加密密钥，如果不存在则使用默认值（仅用于开发）
 */
function getEncryptionKey() {
  const secret = process.env.ENCRYPTION_SECRET || process.env.JWT_SECRET || 'default-encryption-key-change-in-production';

  // 使用 PBKDF2 从密钥生成固定长度的加密密钥
  return crypto.pbkdf2Sync(secret, 'salt', 100000, KEY_LENGTH, 'sha256');
}

/**
 * 加密文本
 * @param {string} text - 要加密的明文
 * @returns {string} 加密后的数据（Base64 编码）
 */
export function encrypt(text) {
  if (!text) return text;

  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const tag = cipher.getAuthTag();

    // 组合 IV + 加密数据 + 认证标签
    const combined = Buffer.concat([
      iv,
      Buffer.from(encrypted, 'hex'),
      tag
    ]);

    return combined.toString('base64');
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * 解密文本
 * @param {string} encryptedData - 加密的数据（Base64 编码）
 * @returns {string} 解密后的明文
 */
export function decrypt(encryptedData) {
  if (!encryptedData) return encryptedData;

  try {
    const key = getEncryptionKey();
    const combined = Buffer.from(encryptedData, 'base64');

    // 提取 IV、加密数据和认证标签
    const iv = combined.subarray(0, IV_LENGTH);
    const tag = combined.subarray(combined.length - TAG_LENGTH);
    const encrypted = combined.subarray(IV_LENGTH, combined.length - TAG_LENGTH);

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted, undefined, 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt data');
  }
}

/**
 * 生成随机加密密钥（用于初始化）
 * @returns {string} Base64 编码的随机密钥
 */
export function generateEncryptionSecret() {
  return crypto.randomBytes(32).toString('base64');
}

/**
 * 哈希敏感数据（单向，用于比较）
 * @param {string} data - 要哈希的数据
 * @returns {string} 哈希值
 */
export function hash(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}
