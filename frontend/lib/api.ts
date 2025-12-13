import axios from 'axios';
import { useAuthStore } from './store';

const rawApiUrl = process.env.NEXT_PUBLIC_API_URL?.trim() || '';
export const API_URL = rawApiUrl.replace(/\/+$/, '');

const api = axios.create({
  baseURL: API_URL || undefined,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor to add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor to handle token refresh
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    // If 401 and we haven't retried yet, try to refresh token
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      const refreshToken = localStorage.getItem('refresh_token');
      if (refreshToken) {
        try {
          const response = await axios.post(`${API_URL}/api/auth/refresh`, {
            refresh_token: refreshToken,
          });

          const { access_token, refresh_token } = response.data;
          localStorage.setItem('access_token', access_token);
          localStorage.setItem('refresh_token', refresh_token);

          // Retry original request with new token
          originalRequest.headers.Authorization = `Bearer ${access_token}`;
          return api(originalRequest);
        } catch (refreshError) {
          // Refresh failed, logout user (let app router navigate, avoid full reload)
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
          try {
            useAuthStore.getState().logout();
          } catch {
            // ignore if store isn't initialized
          }
          return Promise.reject(refreshError);
        }
      }
    }

    return Promise.reject(error);
  }
);

// Auth API
export const authApi = {
  register: (username: string, email: string, password: string) =>
    api.post('/api/auth/register', { username, email, password }),

  login: (username: string, password: string, rememberMe: boolean = false, deviceName?: string) =>
    api.post('/api/auth/login', { username, password, remember_me: rememberMe, device_name: deviceName }),

  logout: (refreshToken: string) =>
    api.post('/api/auth/logout', { refresh_token: refreshToken }),

  getMe: (token?: string) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    return api.get('/api/auth/me', { headers });
  },
};

// User API
export const userApi = {
  getProfile: () =>
    api.get('/api/user/me'),

  updateProfile: (data: { email?: string; avatar?: string }) =>
    api.put('/api/user/me', data),

  getAuthorizations: () =>
    api.get('/api/user/authorizations'),

  revokeAuthorization: (id: number) =>
    api.delete(`/api/user/authorizations/${id}`),

  getSessions: () =>
    api.get('/api/user/sessions'),

  revokeSession: (id: number) =>
    api.delete(`/api/user/sessions/${id}`),
};

// Client API
export const clientApi = {
  list: () =>
    api.get('/api/clients'),

  get: (id: number) =>
    api.get(`/api/clients/${id}`),

  create: (data: {
    name: string;
    description?: string;
    logo?: string;
    redirect_uris: string[];
    allowed_scopes: string[];
    trusted: boolean;
  }) =>
    api.post('/api/clients', data),

  update: (id: number, data: any) =>
    api.put(`/api/clients/${id}`, data),

  delete: (id: number) =>
    api.delete(`/api/clients/${id}`),

  resetSecret: (id: number) =>
    api.post(`/api/clients/${id}/secret`),

  getAccessControl: (id: number) =>
    api.get(`/api/clients/${id}/access-control`),

  updateAccessControl: (id: number, data: {
    allowed_group_ids: number[];
    denied_group_ids: number[];
  }) =>
    api.put(`/api/clients/${id}/access-control`, data),
};

// Group API
export const groupApi = {
  list: () =>
    api.get('/api/groups/'),

  get: (id: number) =>
    api.get(`/api/groups/${id}`),

  create: (data: {
    name: string;
    description?: string;
    is_default: boolean;
  }) =>
    api.post('/api/groups/', data),

  update: (id: number, data: {
    name?: string;
    description?: string;
    is_default?: boolean;
  }) =>
    api.put(`/api/groups/${id}`, data),

  delete: (id: number) =>
    api.delete(`/api/groups/${id}`),

  addMembers: (id: number, user_ids: number[]) =>
    api.post(`/api/groups/${id}/members`, { user_ids }),

  removeMembers: (id: number, user_ids: number[]) =>
    api.delete(`/api/groups/${id}/members`, { data: { user_ids } }),

  setMembers: (id: number, user_ids: number[]) =>
    api.put(`/api/groups/${id}/members`, { user_ids }),
};

// Admin API
export const adminApi = {
  // 用户管理
  listUsers: (skip: number = 0, limit: number = 100) =>
    api.get('/api/admin/users', { params: { skip, limit } }),

  getUser: (id: number) =>
    api.get(`/api/admin/users/${id}`),

  createUser: (data: {
    username: string;
    email: string;
    password: string;
    status?: string;
  }) =>
    api.post('/api/admin/users', data),

  updateUser: (id: number, data: {
    email?: string;
    avatar?: string;
    status?: string;
    password?: string;
  }) =>
    api.put(`/api/admin/users/${id}`, data),

  deleteUser: (id: number) =>
    api.delete(`/api/admin/users/${id}`),

  updateUserGroups: (id: number, group_ids: number[]) =>
    api.put(`/api/admin/users/${id}/groups`, { group_ids }),

  updateUserRoles: (id: number, role_ids: number[]) =>
    api.put(`/api/admin/users/${id}/roles`, { role_ids }),

  // 用户应用权限
  getUserAppPermissions: (id: number) =>
    api.get(`/api/admin/users/${id}/app-permissions`),

  updateUserAppPermissions: (id: number, data: {
    allowed_app_ids: number[];
    denied_app_ids: number[];
  }) =>
    api.put(`/api/admin/users/${id}/app-permissions`, data),

  // 角色管理
  listRoles: () =>
    api.get('/api/admin/roles'),
};

// Group API extensions for app permissions
export const groupAppApi = {
  getAppPermissions: (id: number) =>
    api.get(`/api/groups/${id}/app-permissions`),

  updateAppPermissions: (id: number, data: {
    allowed_app_ids: number[];
    denied_app_ids: number[];
  }) =>
    api.put(`/api/groups/${id}/app-permissions`, data),
};

export default api;
