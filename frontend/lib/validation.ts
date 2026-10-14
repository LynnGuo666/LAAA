/**
 * 密码强度校验：与后端策略严格对齐（backend/app/schemas/__init__.py
 * 的 _validate_password_strength）。
 *
 * 规则：长度 12-72，且大写/小写/数字/特殊字符四类中至少包含 3 类。
 * 前端只在提交前与输入时做即时提示，最终以后端校验为准——
 * 两边规则必须保持同步，否则用户会遭遇「前端放行、后端拒绝」的必现失败。
 */

export interface PasswordStrengthResult {
  valid: boolean;
  /** 无效时的用户可读提示；有效时为空串 */
  message: string;
}

/** 密码规则提示文案（表单 Description / 实时提示共用） */
export const PASSWORD_REQUIREMENT_HINT =
  '密码至少 12 位，需包含大写字母、小写字母、数字、特殊字符中的至少 3 类';

/** ASCII 标点（与 Python string.punctuation 一致：33-126 中非字母数字的部分） */
function isAsciiPunctuation(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code >= 33 && code <= 47) ||
    (code >= 58 && code <= 64) ||
    (code >= 91 && code <= 96) ||
    (code >= 123 && code <= 126)
  );
}

export function validatePasswordStrength(password: string): PasswordStrengthResult {
  if (!password) {
    return { valid: false, message: '请输入密码' };
  }
  if (password.length < 12) {
    return { valid: false, message: '密码至少 12 个字符' };
  }
  if (password.length > 72) {
    return { valid: false, message: '密码不能超过 72 个字符' };
  }
  const categories = [
    /[a-z]/.test(password), // 小写字母
    /[A-Z]/.test(password), // 大写字母
    /\d/.test(password), // 数字
    Array.from(password).some(isAsciiPunctuation), // 特殊字符
  ].filter(Boolean).length;
  if (categories < 3) {
    return {
      valid: false,
      message: '密码需包含大写字母、小写字母、数字、特殊字符中至少 3 类',
    };
  }
  return { valid: true, message: '' };
}
