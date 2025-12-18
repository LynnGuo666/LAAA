import axios from 'axios';
import { useAuthStore } from './store';
import { getDeviceToken } from './device';

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
  register: (username: string, email: string, password: string, inviteCode?: string) =>
    api.post('/api/auth/register', { username, email, password, invite_code: inviteCode }),

  login: (username: string, password: string, rememberMe: boolean = false, deviceName?: string) =>
    api.post('/api/auth/login', {
      username,
      password,
      remember_me: rememberMe,
      device_name: deviceName,
      device_token: getDeviceToken()
    }),

  logout: (refreshToken: string) =>
    api.post('/api/auth/logout', { refresh_token: refreshToken }),

  getMe: (token?: string) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    return api.get('/api/auth/me', { headers });
  },

  // Email verification
  sendVerificationEmail: () =>
    api.post('/api/auth/send-verification-email'),

  verifyEmail: (token: string) =>
    api.get(`/api/auth/verify-email/${token}`),

  // Change email (available in restricted mode)
  changeEmail: (newEmail: string) =>
    api.post('/api/auth/change-email', { new_email: newEmail }),
};

// Site API (public + admin)
export const siteApi = {
  get: () => api.get('/api/site'),
  update: (siteName: string) => api.put('/api/site', { site_name: siteName }),
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

  listApps: () =>
    api.get('/api/user/apps'),

  // Security settings
  getLoginHistory: (skip: number = 0, limit: number = 20) =>
    api.get('/api/user/login-history', { params: { skip, limit } }),

  getSecuritySettings: () =>
    api.get('/api/user/security-settings'),

  updateSecuritySettings: (data: { max_sessions?: number; notify_new_login?: boolean }) =>
    api.put('/api/user/security-settings', data),

  markSessionTrusted: (sessionId: number) =>
    api.post(`/api/user/sessions/${sessionId}/trust`),

  unmarkSessionTrusted: (sessionId: number) =>
    api.delete(`/api/user/sessions/${sessionId}/trust`),

  revokeOtherSessions: () =>
    api.post('/api/user/sessions/revoke-others'),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.put('/api/user/password', { current_password: currentPassword, new_password: newPassword }),
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
    website_url?: string;
    redirect_uris: string[];
    allowed_scopes: string[];
    trusted: boolean;
    default_access: boolean;
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
  // 用户管理（分页+搜索）
  listUsers: (params: { skip?: number; limit?: number; search?: string } = {}) =>
    api.get('/api/admin/users', { params }),

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

  // 计算后应用权限（分页+搜索）
  getUserComputedAppPermissions: (id: number, params: { skip?: number; limit?: number; search?: string } = {}) =>
    api.get(`/api/admin/users/${id}/app-permissions/computed`, { params }),

  // 更新单个应用权限
  updateUserSingleAppPermission: (userId: number, appId: number, permission: string | null) =>
    api.put(`/api/admin/users/${userId}/app-permissions/single`, null, {
      params: { app_id: appId, permission }
    }),

  // 角色管理
  listRoles: () =>
    api.get('/api/admin/roles'),

  // 邀请码管理
  listInvites: (params: { skip?: number; limit?: number; active?: boolean } = {}) =>
    api.get('/api/admin/invites/', { params }),

  createInvite: (data: { group_id: number; expires_at?: string; max_uses?: number; note?: string }) =>
    api.post('/api/admin/invites/', data),

  updateInvite: (id: number, data: { is_active?: boolean; expires_at?: string | null; max_uses?: number | null; note?: string | null }) =>
    api.put(`/api/admin/invites/${id}`, data),

  // 用户登录日志
  getUserLoginLogs: (userId: number, params: { skip?: number; limit?: number } = {}) =>
    api.get(`/api/admin/users/${userId}/login-logs`, { params }),

  // 用户会话管理
  getUserSessions: (userId: number) =>
    api.get(`/api/admin/users/${userId}/sessions`),

  revokeUserSession: (userId: number, sessionId: number) =>
    api.delete(`/api/admin/users/${userId}/sessions/${sessionId}`),

  revokeAllUserSessions: (userId: number) =>
    api.delete(`/api/admin/users/${userId}/sessions`),

  // 用户通行密钥
  getUserPasskeys: (userId: number) =>
    api.get(`/api/admin/users/${userId}/passkeys`),

  // 用户授权记录
  getUserAuthorizations: (userId: number) =>
    api.get(`/api/admin/users/${userId}/authorizations`),

  // 用户安全验证方式
  getUserSecurityMethods: (userId: number) =>
    api.get(`/api/admin/users/${userId}/security-methods`),
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

// Passkey API
export const passkeyApi = {
  // Get registration options (requires auth)
  getRegistrationOptions: () =>
    api.post('/api/passkeys/register/options'),

  // Verify registration (requires auth)
  verifyRegistration: (data: {
    id: string;
    rawId: string;
    response: object;
    type: string;
    clientExtensionResults?: object;
    authenticatorAttachment?: string;
    name: string;
  }) =>
    api.post('/api/passkeys/register/verify', data),

  // Get authentication options (no auth required)
  getAuthenticationOptions: (username?: string) =>
    axios.post(`${API_URL}/api/passkeys/authenticate/options`, { username }),

  // Verify authentication (no auth required)
  verifyAuthentication: (data: {
    id: string;
    rawId: string;
    response: object;
    type: string;
    clientExtensionResults?: object;
    authenticatorAttachment?: string;
    remember_me?: boolean;
    device_name?: string;
    device_token?: string;
  }) =>
    axios.post(`${API_URL}/api/passkeys/authenticate/verify`, {
      ...data,
      device_token: data.device_token || getDeviceToken()
    }),

  // Check if user has passkeys (no auth required)
  checkUserPasskeys: (username: string) =>
    axios.get(`${API_URL}/api/passkeys/check/${username}`),

  // List passkeys (requires auth)
  list: () =>
    api.get('/api/passkeys/'),

  // Rename passkey (requires auth)
  rename: (id: number, name: string) =>
    api.put(`/api/passkeys/${id}`, { name }),

  // Delete passkey (requires auth)
  delete: (id: number) =>
    api.delete(`/api/passkeys/${id}`),
};

// Verification API (for multi-step verification during login)
export const verificationApi = {
  // Get verification session status
  getStatus: (sessionToken: string) =>
    axios.get(`${API_URL}/api/auth/verify/status/${sessionToken}`),

  // Send email verification code
  sendEmailCode: (sessionToken: string) =>
    axios.post(`${API_URL}/api/auth/verify/email-code/send`, { session_token: sessionToken }),

  // Verify email code
  verifyEmailCode: (sessionToken: string, code: string) =>
    axios.post(`${API_URL}/api/auth/verify/email-code`, { session_token: sessionToken, code }),

  // Verify TOTP code
  verifyTOTP: (sessionToken: string, code: string) =>
    axios.post(`${API_URL}/api/auth/verify/totp`, { session_token: sessionToken, code }),

  // Verify backup code
  verifyBackupCode: (sessionToken: string, code: string) =>
    axios.post(`${API_URL}/api/auth/verify/backup-code`, { session_token: sessionToken, code }),

  // Send magic link
  sendMagicLink: (sessionToken: string) =>
    axios.post(`${API_URL}/api/auth/verify/magic-link/send`, { session_token: sessionToken }, { withCredentials: true }),

  // Verify magic link (called from magic link page)
  verifyMagicLink: (token: string, sessionToken: string) =>
    axios.get(`${API_URL}/api/auth/verify/magic-link/${token}`, {
      params: { session: sessionToken },
      withCredentials: true
    }),

  // Start passkey verification
  startPasskeyVerification: (sessionToken: string) =>
    axios.post(`${API_URL}/api/auth/verify/passkey/start`, { session_token: sessionToken }),

  // Complete passkey verification
  completePasskeyVerification: (sessionToken: string, credential: object) =>
    axios.post(`${API_URL}/api/auth/verify/passkey/complete`, {
      session_token: sessionToken,
      credential
    }),

  // Magic Link independent login - send
  sendMagicLinkLogin: (email: string) =>
    axios.post(`${API_URL}/api/auth/magic-link/login`, { email }, { withCredentials: true }),

  // Magic Link independent login - verify
  verifyMagicLinkLogin: (token: string) =>
    axios.get(`${API_URL}/api/auth/magic-link/login/${token}`, { withCredentials: true }),

  // Skip verification (enter restricted mode)
  skipVerification: (sessionToken: string) =>
    axios.post(`${API_URL}/api/auth/verify/skip`, { session_token: sessionToken }),
};

// TOTP API (Two-Factor Authentication)
export const totpApi = {
  // Get TOTP status
  getStatus: () =>
    api.get('/api/totp/status'),

  // Start TOTP setup
  setup: () =>
    api.post('/api/totp/setup'),

  // Verify and enable TOTP
  verifySetup: (code: string) =>
    api.post('/api/totp/verify-setup', { code }),

  // Disable TOTP
  disable: (password: string) =>
    api.delete('/api/totp', { data: { password } }),

  // Regenerate backup codes
  regenerateBackupCodes: (password: string) =>
    api.post('/api/totp/backup-codes', { password }),
};

export default api;
