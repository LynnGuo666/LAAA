import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface User {
  id: number;
  username: string;
  email: string;
  avatar?: string;
  status: string;
  email_verified?: boolean;
  created_at: string;
  groups?: string[];
  roles?: string[];
  permissions?: string[];
  is_admin?: boolean;
  is_restricted?: boolean;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setUser: (user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,

      // token 只存内存（A2 方案）：持久化交给后端 HttpOnly cookie
      // （laaa_refresh / authorize_token），localStorage 不再落任何 token；
      // 页面刷新后的会话恢复由 lib/bootstrap.ts 静默完成。
      setAuth: (user, accessToken, refreshToken) => {
        set({
          user,
          accessToken,
          refreshToken,
          isAuthenticated: true,
        });
      },

      // refresh 旋转后回写内存 token（不动 user / isAuthenticated）
      setTokens: (accessToken, refreshToken) =>
        set({ accessToken, refreshToken }),

      setUser: (user) => set({ user }),

      logout: () => {
        if (typeof window !== 'undefined') {
          // 显式广播登出：其他 tab 监听此 key 同步登出（见 lib/bootstrap.ts）。
          // 不能监听 refresh_token key 的删除——bootstrap 迁移成功后清理残留
          // 也会删它，会把别的 tab 误登出。
          localStorage.setItem('laaa_logout', String(Date.now()));

          // 迁移清理：旧版残留在 localStorage 的 token 一并清掉
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');

          // 兼容期：清掉旧名 session_token cookie
          // （新名 laaa_refresh / authorize_token 是 HttpOnly，只能由后端 logout 响应清除）
          document.cookie = 'session_token=; path=/; max-age=0';
        }

        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          isAuthenticated: false,
        });
      },
    }),
    {
      name: 'laaa-auth',
      // 只持久化 user / isAuthenticated；token 只在内存，
      // 刷新页面后靠 lib/bootstrap.ts 静默恢复（legacy localStorage 或 laaa_refresh cookie）。
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
