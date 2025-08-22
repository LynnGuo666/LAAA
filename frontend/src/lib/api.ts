import axios, { AxiosResponse } from 'axios';
import Cookies from 'js-cookie';
import { v4 as uuidv4 } from 'uuid';
import {
  User,
  LoginRequest,
  LoginResponse,
  RegisterRequest,
  TOTPSetupResponse,
  Device,
  Application,
  InvitationCode,
  Permission,
  SystemStats
} from '../types/auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

class ApiClient {
  private baseURL: string;
  private deviceId: string | null = null;

  constructor() {
    this.baseURL = API_BASE_URL;
    
    // 请求拦截器 - 添加认证头和设备ID
    axios.interceptors.request.use((config) => {
      const token = Cookies.get('access_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      config.headers['X-Device-ID'] = this.getDeviceId();
      return config;
    });

    // 响应拦截器 - 处理401错误
    axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        // 暂时禁用自动token刷新，直接返回错误让组件处理
        return Promise.reject(error);
      }
    );
  }

  private getDeviceId(): string {
    if (this.deviceId) return this.deviceId;
    
    // 检查是否在浏览器环境
    if (typeof window === 'undefined') {
      // 服务端渲染时返回一个临时ID
      this.deviceId = 'ssr-temp-device';
      return this.deviceId;
    }
    
    let deviceId = localStorage.getItem('device_id');
    if (!deviceId) {
      deviceId = uuidv4();
      localStorage.setItem('device_id', deviceId);
    }
    this.deviceId = deviceId;
    return deviceId;
  }

  // 认证相关API
  async login(data: LoginRequest): Promise<LoginResponse> {
    const response: AxiosResponse<LoginResponse> = await axios.post(
      `${this.baseURL}/api/v1/auth/login`,
      data
    );
    return response.data;
  }

  async register(data: RegisterRequest): Promise<{ message: string; user_id: string }> {
    const response = await axios.post(`${this.baseURL}/api/v1/auth/register`, data);
    return response.data;
  }

  async getMe(): Promise<User> {
    const response: AxiosResponse<User> = await axios.get(`${this.baseURL}/api/v1/auth/me`);
    return response.data;
  }

  async enableTOTP(): Promise<TOTPSetupResponse> {
    const response: AxiosResponse<TOTPSetupResponse> = await axios.post(
      `${this.baseURL}/api/v1/auth/enable-totp`
    );
    return response.data;
  }

  async verifyTOTP(token: string): Promise<{ message: string }> {
    const response = await axios.post(`${this.baseURL}/api/v1/auth/verify-totp`, { token });
    return response.data;
  }

  async getDevices(): Promise<Device[]> {
    const response: AxiosResponse<Device[]> = await axios.get(
      `${this.baseURL}/api/v1/auth/devices`
    );
    return response.data;
  }

  async trustDevice(deviceId: string, trusted: boolean = true): Promise<{ message: string }> {
    const response = await axios.post(
      `${this.baseURL}/api/v1/auth/devices/${deviceId}/trust?trusted=${trusted}`
    );
    return response.data;
  }

  // OAuth相关API
  async refreshToken(refreshToken: string): Promise<{ access_token: string }> {
    const response = await axios.post(`${this.baseURL}/oauth/token`, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken
    });
    return response.data;
  }

  // 管理员API
  async createInvitationCode(data: {
    security_level?: number;
    max_uses?: number;
    expire_days?: number;
  }): Promise<InvitationCode> {
    const response: AxiosResponse<InvitationCode> = await axios.post(
      `${this.baseURL}/api/v1/admin/invitation-codes`,
      data
    );
    return response.data;
  }

  async getInvitationCodes(activeOnly: boolean = true): Promise<InvitationCode[]> {
    const response: AxiosResponse<InvitationCode[]> = await axios.get(
      `${this.baseURL}/api/v1/admin/invitation-codes?active_only=${activeOnly}`
    );
    return response.data;
  }

  async deactivateInvitationCode(codeId: string): Promise<{ message: string }> {
    const response = await axios.delete(
      `${this.baseURL}/api/v1/admin/invitation-codes/${codeId}`
    );
    return response.data;
  }

  async getUsers(params?: {
    page?: number;
    size?: number;
    security_level?: number;
    active_only?: boolean;
  }): Promise<User[]> {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.size) queryParams.append('size', params.size.toString());
    if (params?.security_level) queryParams.append('security_level', params.security_level.toString());
    if (params?.active_only !== undefined) queryParams.append('active_only', params.active_only.toString());

    const response: AxiosResponse<User[]> = await axios.get(
      `${this.baseURL}/api/v1/admin/users?${queryParams.toString()}`
    );
    return response.data;
  }

  async updateUserSecurityLevel(userId: string, securityLevel: number): Promise<{ message: string }> {
    const response = await axios.put(
      `${this.baseURL}/api/v1/admin/users/${userId}/security-level?security_level=${securityLevel}`
    );
    return response.data;
  }

  async deactivateUser(userId: string): Promise<{ message: string }> {
    const response = await axios.delete(`${this.baseURL}/api/v1/admin/users/${userId}`);
    return response.data;
  }

  async createApplication(data: {
    name: string;
    description?: string;
    logo_url?: string;
    website_url?: string;
    support_email?: string;
    privacy_policy_url?: string;
    terms_of_service_url?: string;
    redirect_uris?: string[];
    required_security_level?: number;
    require_mfa?: boolean;
  }): Promise<Application> {
    const response: AxiosResponse<Application> = await axios.post(
      `${this.baseURL}/api/v1/admin/applications`,
      data
    );
    return response.data;
  }

  async getApplications(): Promise<Application[]> {
    const response: AxiosResponse<Application[]> = await axios.get(
      `${this.baseURL}/api/v1/admin/applications`
    );
    return response.data;
  }

  async updateApplication(appId: string, data: {
    name: string;
    description?: string;
    logo_url?: string;
    website_url?: string;
    support_email?: string;
    privacy_policy_url?: string;
    terms_of_service_url?: string;
    redirect_uris?: string[];
    required_security_level?: number;
    require_mfa?: boolean;
  }): Promise<{ message: string }> {
    const response = await axios.put(`${this.baseURL}/api/v1/admin/applications/${appId}`, data);
    return response.data;
  }

  async deleteApplication(appId: string): Promise<{ message: string }> {
    const response = await axios.delete(`${this.baseURL}/api/v1/admin/applications/${appId}`);
    return response.data;
  }

  // 应用用户管理API
  async getApplicationUsers(appId: string): Promise<{
    users: Array<{
      id: string;
      username: string;
      email: string;
      security_level: number;
      is_active: boolean;
      granted_at: string;
    }>
  }> {
    const response = await axios.get(
      `${this.baseURL}/api/v1/admin/applications/${appId}/users`
    );
    return response.data;
  }

  async getAvailableUsersForApplication(appId: string): Promise<{
    users: Array<{
      id: string;
      username: string;
      email: string;
      security_level: number;
    }>
  }> {
    const response = await axios.get(
      `${this.baseURL}/api/v1/admin/applications/${appId}/available-users`
    );
    return response.data;
  }

  async grantApplicationAccess(appId: string, userId: string): Promise<{
    message: string;
    permission_id: string;
  }> {
    const response = await axios.post(
      `${this.baseURL}/api/v1/admin/applications/${appId}/users/${userId}/grant-access`
    );
    return response.data;
  }

  async revokeApplicationAccess(appId: string, userId: string): Promise<{
    message: string;
  }> {
    const response = await axios.delete(
      `${this.baseURL}/api/v1/admin/applications/${appId}/users/${userId}/revoke-access`
    );
    return response.data;
  }

  async getSystemStats(): Promise<SystemStats> {
    const response: AxiosResponse<SystemStats> = await axios.get(
      `${this.baseURL}/api/v1/admin/stats`
    );
    return response.data;
  }

  // 工具方法
  logout(): void {
    Cookies.remove('access_token');
    Cookies.remove('refresh_token');
    if (typeof window !== 'undefined') {
      window.location.href = '/auth/login';
    }
  }

  setTokens(accessToken: string, refreshToken: string): void {
    Cookies.set('access_token', accessToken, { expires: 1 }); // 1天
    Cookies.set('refresh_token', refreshToken, { expires: 30 }); // 30天
  }

  isAuthenticated(): boolean {
    return !!Cookies.get('access_token');
  }
}

export const apiClient = new ApiClient();