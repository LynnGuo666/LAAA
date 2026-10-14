import type { User } from './store';

export function hasPermission(user: User | null | undefined, permissionCode: string): boolean {
  if (!user) return false;
  const permissions = user.permissions ?? [];
  return permissions.includes('admin.*') || permissions.includes(permissionCode);
}

export function isAdmin(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.is_admin) return true;
  const permissions = user.permissions ?? [];
  if (permissions.includes('admin.*')) return true;
  const roles = user.roles ?? [];
  return roles.includes('admin');
}

/**
 * 校验登录后跳转地址是否为安全的站内路径。
 * 仅允许以单个 `/` 开头的相对路径：
 * - `//evil.com`（协议相对 URL）会被浏览器解析为外部域名，必须拒绝；
 * - 完整 URL（`https://...`）同样拒绝。
 */
export function isSafeRedirect(url: string | null | undefined): url is string {
  if (!url) return false;
  return url.startsWith('/') && !url.startsWith('//');
}
