import { create } from 'zustand';

interface User {
  id: number;
  username: string;
  email: string;
  avatar?: string;
  status: string;
  created_at: string;
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
    }

    set({
      user: null,
      accessToken: null,
      refreshToken: null,
      isAuthenticated: false,
    });
  },
}));
