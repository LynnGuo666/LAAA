/**
 * 时间格式化工具函数
 * 后端返回的时间为 UTC 时间（格式: "2024-01-01T00:00:00"，无时区标记）
 * 这些函数会正确将 UTC 时间转换为用户本地时区显示
 */

/**
 * 将后端返回的 UTC 时间字符串格式化为本地日期时间
 * @param dateString - ISO 格式的时间字符串（UTC）
 * @returns 本地化的日期时间字符串，如 "2024/1/1 08:00:00"
 */
export function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return '-';
  // 如果字符串没有 Z 后缀，添加 Z 表示 UTC
  const utcString = dateString.endsWith('Z') ? dateString : dateString + 'Z';
  const date = new Date(utcString);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleString('zh-CN');
}

/**
 * 将后端返回的 UTC 时间字符串格式化为本地日期
 * @param dateString - ISO 格式的时间字符串（UTC）
 * @returns 本地化的日期字符串，如 "2024/1/1"
 */
export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '-';
  const utcString = dateString.endsWith('Z') ? dateString : dateString + 'Z';
  const date = new Date(utcString);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleDateString('zh-CN');
}

/**
 * 将后端返回的 UTC 时间字符串格式化为本地时间
 * @param dateString - ISO 格式的时间字符串（UTC）
 * @returns 本地化的时间字符串，如 "08:00:00"
 */
export function formatTime(dateString: string | null | undefined): string {
  if (!dateString) return '-';
  const utcString = dateString.endsWith('Z') ? dateString : dateString + 'Z';
  const date = new Date(utcString);
  if (isNaN(date.getTime())) return '-';
  return date.toLocaleTimeString('zh-CN');
}

/**
 * 将后端返回的 UTC 时间字符串格式化为相对时间
 * @param dateString - ISO 格式的时间字符串（UTC）
 * @returns 相对时间字符串，如 "刚刚"、"5 分钟前"、"2 小时前"
 */
export function formatRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) return '-';
  const utcString = dateString.endsWith('Z') ? dateString : dateString + 'Z';
  const date = new Date(utcString);
  if (isNaN(date.getTime())) return '-';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return '刚刚';
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;
  if (diffHours < 24) return `${diffHours} 小时前`;
  if (diffDays < 7) return `${diffDays} 天前`;

  return formatDateTime(dateString);
}
