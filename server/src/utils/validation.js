/**
 * 输入验证工具
 * 提供密码强度验证和基本输入验证功能
 */

import { VALIDATION } from './constants.js';

/**
 * 验证密码强度
 * @param {string} password - 要验证的密码
 * @returns {object} - { valid: boolean, errors: string[] }
 */
export function validatePassword(password) {
  const errors = [];

  if (!password) {
    errors.push('密码不能为空');
    return { valid: false, errors };
  }

  if (password.length < VALIDATION.PASSWORD_MIN_LENGTH) {
    errors.push(`密码长度至少为 ${VALIDATION.PASSWORD_MIN_LENGTH} 个字符`);
  }

  if (password.length > VALIDATION.PASSWORD_MAX_LENGTH) {
    errors.push(`密码长度不能超过 ${VALIDATION.PASSWORD_MAX_LENGTH} 个字符`);
  }

  // 检查是否包含至少一个字母和一个数字
  const hasLetter = /[A-Za-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);

  if (!hasLetter) {
    errors.push('密码必须包含至少一个字母');
  }

  if (!hasNumber) {
    errors.push('密码必须包含至少一个数字');
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * 验证邮箱格式
 * @param {string} email - 要验证的邮箱
 * @returns {boolean}
 */
export function validateEmail(email) {
  if (!email) return false;

  // 简单的邮箱格式验证
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

/**
 * 验证用户注册数据
 * @param {object} data - { email, password, name? }
 * @returns {object} - { valid: boolean, errors: object }
 */
export function validateRegisterData(data) {
  const errors = {};

  // 验证邮箱
  if (!data.email) {
    errors.email = '邮箱不能为空';
  } else if (!validateEmail(data.email)) {
    errors.email = '邮箱格式不正确';
  }

  // 验证密码
  const passwordValidation = validatePassword(data.password);
  if (!passwordValidation.valid) {
    errors.password = passwordValidation.errors;
  }

  // 验证名称（可选）
  if (data.name && data.name.length > VALIDATION.NAME_MAX_LENGTH) {
    errors.name = `用户名长度不能超过 ${VALIDATION.NAME_MAX_LENGTH} 个字符`;
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors
  };
}

/**
 * 验证日期字符串格式
 * @param {string} dateStr - 日期字符串
 * @returns {Date|null} - 解析后的日期对象，无效则返回 null
 */
export function validateDate(dateStr) {
  if (!dateStr) return null;

  const date = new Date(dateStr);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * 验证 UUID 格式
 * @param {string} uuid - UUID 字符串
 * @returns {boolean}
 */
export function validateUUID(uuid) {
  if (!uuid) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

/**
 * 验证和清理搜索字符串
 * @param {string} search - 搜索字符串
 * @param {number} maxLength - 最大长度（默认 100）
 * @returns {string}
 */
export function sanitizeSearchString(search, maxLength = 100) {
  if (!search || typeof search !== 'string') return '';
  // 移除特殊字符，防止注入攻击
  return search.replace(/[<>\"'%;()&+]/g, '').substring(0, maxLength);
}

