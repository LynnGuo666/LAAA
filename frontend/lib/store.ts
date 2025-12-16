import { create } from 'zustand';

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
  setUser: (user: User) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  isAuthenticated: false,

  setAuth: (user, accessToken, refreshToken) => {
    // Store tokens in localStorage
    if (typeof window !== 'undefined') {
      localStorage.setItem('access_token', accessToken);
      localStorage.setItem('refresh_token', refreshToken);

      // Also set session cookie for OAuth authorize endpoint (cross-origin)
      // Cookie is HttpOnly: false so JS can set it, but SameSite: Lax for CSRF protection
      const maxAge = 60 * 60 * 24 * 7; // 7 days
      document.cookie = `session_token=${accessToken}; path=/; max-age=${maxAge}; SameSite=Lax`;
    }

    set({
      user,
      accessToken,
      refreshToken,
      isAuthenticated: true,
    });
  },

  setUser: (user) => set({ user }),

  logout: () => {
    // Clear tokens from localStorage
    if (typeof window !== 'undefined') {
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');

      // Also clear session cookie
      document.cookie = 'session_token=; path=/; max-age=0';
    }

    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
    });
  },
}));
