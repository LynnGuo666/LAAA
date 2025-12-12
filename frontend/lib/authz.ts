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
