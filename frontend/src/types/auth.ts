export interface User {
  id: string;
  username: string;
  email: string;
  security_level: number;
  totp_enabled: boolean;
  email_verified: boolean;
  phone?: string;
  phone_verified: boolean;
  is_active: boolean;
  created_at: string;
  last_login_at?: string;
}

export interface LoginRequest {
  username: string;
  password: string;
  totp_token?: string;
}

export interface LoginResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  user?: User;
  requires_mfa?: boolean;
  message?: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
  invitation_code: string;
}

export interface TOTPSetupResponse {
  secret: string;
  qr_code: string;
  message: string;
}

export interface Device {
  id: string;
  device_id: string;
  device_name?: string;
  device_type: string;
  is_trusted: boolean;
  last_seen_at: string;
}

export interface Application {
  id: string;
  name: string;
  description?: string;
  client_id: string;
  redirect_uris: string[];
  required_security_level: number;
  require_mfa: boolean;
  is_active: boolean;
  created_at: string;
}

export interface InvitationCode {
  id: string;
  code: string;
  security_level: number;
  max_uses: number;
  current_uses: number;
  expires_at: string;
  is_active: boolean;
  created_at: string;
}

export interface Permission {
  id: string;
  name: string;
  resource: string;
  action: string;
  description?: string;
  required_security_level: number;
  require_additional_verification: boolean;
}

export interface SystemStats {
  total_users: number;
  active_users: number;
  total_applications: number;
  active_invitations: number;
}