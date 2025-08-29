import axios from 'axios';
import Cookies from 'js-cookie';
import { LoginCredentials, User, ClientApplication, TokenResponse } from '@/types';

// 在静态部署时，API基础URL应该是当前域名
const API_BASE_URL = typeof window !== 'undefined' 
  ? `${window.location.protocol}//${window.location.host}` 
  : 'http://localhost:8000';

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// 请求拦截器 - 添加认证token
apiClient.interceptors.request.use((config) => {
  const token = Cookies.get('access_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// 响应拦截器 - 处理错误
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token过期，清除cookie
      Cookies.remove('access_token');
      Cookies.remove('refresh_token');
      // 如果不在登录页面，重定向到登录页面
      if (typeof window !== 'undefined' && !window.location.pathname.includes('/login')) {
        window.location.href = '/login/';
      }
    }
    return Promise.reject(error);
  }
);

export const authApi = {
  // 用户登录
  login: async (credentials: LoginCredentials): Promise<TokenResponse> => {
    const formData = new FormData();
    formData.append('username', credentials.username);
    formData.append('password', credentials.password);
    formData.append('grant_type', 'password');

    const response = await axios.post(`${API_BASE_URL}/oauth/token`, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });
    return response.data;
  },

  // 处理OAuth授权
  authorize: async (authData: {
    username: string;
    password: string;
    client_id: string;
    redirect_uri: string;
    scope: string;
    state?: string;
    code_challenge?: string;
    code_challenge_method?: string;
    nonce?: string;
    consent: boolean;
  }) => {
    const formData = new FormData();
    Object.entries(authData).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        formData.append(key, value.toString());
      }
    });

    const response = await axios.post(`${API_BASE_URL}/oauth/authorize`, formData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      maxRedirects: 0,  // 不自动跟随重定向
      validateStatus: (status) => status < 400 || (status >= 300 && status < 400),  // 允许所有重定向状态码
    });
    
    return response;
  },

  // 获取当前用户信息
  getCurrentUser: async (): Promise<User> => {
    const response = await apiClient.get('/api/v1/users/me');
    return response.data;
  },

  // 获取客户端公开信息
  getClientInfo: async (clientId: string): Promise<ClientApplication> => {
    const response = await apiClient.get(`/api/v1/clients/${clientId}`);
    return response.data;
  },

  // 用户注册
  register: async (userData: {
    email: string;
    username: string;
    password: string;
    full_name?: string;
  }): Promise<User> => {
    const response = await apiClient.post('/api/v1/users', userData);
    return response.data;
  },

  // 权限相关API
  checkPermission: async (userId: string, clientId: string, scopes: string[]): Promise<any> => {
    const response = await apiClient.post('/api/v1/permissions/check', {
      user_id: userId,
      client_id: clientId,
      requested_scopes: scopes
    });
    return response.data;
  },

  createPermissionRequest: async (data: {
    client_id: string;
    requested_scopes: string[];
    request_reason?: string;
  }): Promise<any> => {
    const response = await apiClient.post('/api/v1/permissions/requests', data);
    return response.data;
  },

  getMyPermissionRequests: async (): Promise<any[]> => {
    const response = await apiClient.get('/api/v1/permissions/requests/my');
    return response.data;
  },

  getUserPermissions: async (userId: string): Promise<any[]> => {
    const response = await apiClient.get(`/api/v1/permissions/user/${userId}`);
    return response.data;
  },

  // 管理员API - 用户管理
  getAllUsers: async (): Promise<any[]> => {
    const response = await apiClient.get('/api/v1/users');
    return response.data;
  },

  getUserById: async (userId: string): Promise<any> => {
    const response = await apiClient.get(`/api/v1/users/${userId}`);
    return response.data;
  },

  updateUser: async (userId: string, userData: any): Promise<any> => {
    const response = await apiClient.put(`/api/v1/users/${userId}`, userData);
    return response.data;
  },

  deleteUser: async (userId: string): Promise<any> => {
    const response = await apiClient.delete(`/api/v1/users/${userId}`);
    return response.data;
  },

  // 管理员API - 应用管理
  getAllClients: async (): Promise<any[]> => {
    const response = await apiClient.get('/api/v1/clients');
    return response.data;
  },

  updateClient: async (clientId: string, clientData: any): Promise<any> => {
    const response = await apiClient.put(`/api/v1/clients/${clientId}`, clientData);
    return response.data;
  },

  deleteClient: async (clientId: string): Promise<any> => {
    const response = await apiClient.delete(`/api/v1/clients/${clientId}`);
    return response.data;
  },

  createClient: async (clientData: any): Promise<any> => {
    const response = await apiClient.post('/api/v1/clients', clientData);
    return response.data;
  },

  // 管理员API - 权限管理
  getUserPermissionsByAdmin: async (userId: string): Promise<any[]> => {
    const response = await apiClient.get(`/api/v1/admin/users/${userId}/permissions`);
    return response.data;
  },

  grantUserPermission: async (userId: string, clientId: string, permissionData: any): Promise<any> => {
    const response = await apiClient.post(`/api/v1/admin/users/${userId}/permissions/${clientId}`, permissionData);
    return response.data;
  },

  revokeUserPermission: async (userId: string, clientId: string): Promise<any> => {
    const response = await apiClient.delete(`/api/v1/admin/users/${userId}/permissions/${clientId}`);
    return response.data;
  },

  // 权限组管理
  getPermissionGroups: async (): Promise<any[]> => {
    const response = await apiClient.get('/api/v1/permissions/groups');
    return response.data;
  },

  getPermissionGroup: async (clientId: string): Promise<any> => {
    const response = await apiClient.get(`/api/v1/permissions/groups/${clientId}`);
    return response.data;
  },

  updatePermissionGroup: async (clientId: string, groupData: any): Promise<any> => {
    const response = await apiClient.put(`/api/v1/permissions/groups/${clientId}`, groupData);
    return response.data;
  },
};

export default apiClient;