/**
 * API 错误信息提取：把任意 catch 到的错误归一化为可安全渲染的**字符串**。
 *
 * 背景：FastAPI 422 的 `detail` 是 pydantic 错误对象数组（每项含 msg/loc 等），
 * 若直接 `setError(err.response?.data?.detail || ...)` 把数组塞进 JSX，会触发
 * "Objects are not valid as a React child" 导致整页崩溃到 error boundary。
 * 所有 `setError` / `toast` 的错误展示必须经 `extractErrorMessage`。
 *
 * 兼容的后端错误形态：
 * 1. `detail` 为字符串（业务错误，HTTPException）→ 直接使用
 * 2. `detail` 为数组（422 参数校验，每项 {msg, loc}）→ 取首项 msg，
 *    可拼接字段名（loc 末段）帮助定位
 * 3. `detail` 为对象（结构化错误，如 refresh 端点的
 *    `{"code": "session_revoked", "message": ...}`）→ 优先 message 字段
 * 4. 网络错误（无 response，lib/api.ts 已注入中文 message）→ 使用 error.message
 * 5. 以上都无 → 返回 fallback 中文文案
 */

/** 422 loc 中常见字段名 → 中文标签（缺失字段提示等场景用）。 */
const FIELD_LABELS: Record<string, string> = {
  password: '密码',
  new_password: '新密码',
  current_password: '当前密码',
  username: '用户名',
  email: '邮箱',
  new_email: '新邮箱',
  invite_code: '邀请码',
  refresh_token: '刷新令牌',
  client_id: '客户端 ID',
  client_secret: '客户端密钥',
  code: '验证码',
  scope: '授权范围',
  redirect_uri: '回调地址',
};

/** 单个 pydantic 校验错误项 → 人类可读字符串。 */
function validationItemToString(item: unknown): string {
  if (!item || typeof item !== 'object') return '';
  const { msg, loc } = item as { msg?: unknown; loc?: unknown };

  let message = typeof msg === 'string' ? msg.replace(/^Value error,\s*/, '') : '';
  if (!message) return '';

  // loc 形如 ["body", "password"]，取最后一段作为字段名（过滤掉 "body" 等容器段）
  const segments = Array.isArray(loc) ? loc.filter((l) => typeof l === 'string') : [];
  const field = segments.length > 0 ? segments[segments.length - 1] : '';

  if (field) {
    const label = FIELD_LABELS[field] || field;
    if (message === 'Field required') return `请填写${label}`;
    // msg 已包含字段含义（如「密码至少 12 个字符」）时不再重复前缀
    if (!message.includes(label)) return `${label}：${message}`;
  }
  return message;
}

/** detail 字段（任意形态）→ 字符串；无法提取时返回空串。 */
function detailToString(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    // 多个校验错误时取首个（最相关）；全部为空则交给上层 fallback
    for (const item of detail) {
      const s = validationItemToString(item);
      if (s) return s;
    }
    return '';
  }
  if (detail && typeof detail === 'object') {
    // 结构化错误：{"code": ..., "message": ...}，优先 message
    const d = detail as { message?: unknown; msg?: unknown };
    if (typeof d.message === 'string' && d.message) return d.message;
    if (typeof d.msg === 'string' && d.msg) return d.msg;
  }
  return '';
}

/**
 * 从任意错误中提取可安全渲染的字符串。
 *
 * @param err      catch 块里的错误对象（axios error / Error / unknown）
 * @param fallback 全部提取失败时的兜底文案
 */
export function extractErrorMessage(
  err: unknown,
  fallback = '操作失败，请稍后重试',
): string {
  if (typeof err === 'string' && err) return err;
  if (!err || typeof err !== 'object') return fallback;

  const error = err as {
    response?: { data?: { detail?: unknown } };
    message?: unknown;
  };

  const fromDetail = detailToString(error.response?.data?.detail);
  if (fromDetail) return fromDetail;

  if (typeof error.message === 'string' && error.message) return error.message;

  return fallback;
}
