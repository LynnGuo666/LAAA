/**
 * WebAuthn utility functions for browser interaction
 */

export interface PasskeyCredential {
  id: number;
  name: string;
  credential_id: string;  // Base64URL encoded credential ID
  created_at: string;
  last_used_at?: string;
  transports?: string[];
  backup_eligible: boolean;
  backup_state: boolean;
  aaguid?: string;
}

/**
 * Check if WebAuthn is supported by the browser
 */
export function isWebAuthnSupported(): boolean {
  return !!(navigator.credentials && window.PublicKeyCredential);
}

/**
 * Check if platform authenticator is available (e.g., Touch ID, Face ID, Windows Hello)
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Convert ArrayBuffer to Base64URL string
 */
export function bufferToBase64URL(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (const byte of bytes) {
    str += String.fromCharCode(byte);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Convert Base64URL string to ArrayBuffer
 */
export function base64URLToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(base64 + padding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * Parse registration options from server response
 */
export function parseRegistrationOptions(options: any): PublicKeyCredentialCreationOptions {
  return {
    ...options,
    challenge: base64URLToBuffer(options.challenge),
    user: {
      ...options.user,
      id: base64URLToBuffer(options.user.id),
    },
    excludeCredentials: options.excludeCredentials?.map((cred: any) => ({
      ...cred,
      id: base64URLToBuffer(cred.id),
    })) || [],
  };
}

/**
 * Parse authentication options from server response
 */
export function parseAuthenticationOptions(options: any): PublicKeyCredentialRequestOptions {
  return {
    ...options,
    challenge: base64URLToBuffer(options.challenge),
    allowCredentials: options.allowCredentials?.map((cred: any) => ({
      ...cred,
      id: base64URLToBuffer(cred.id),
    })) || [],
  };
}

/**
 * Create a new passkey credential
 */
export async function createPasskeyCredential(
  options: PublicKeyCredentialCreationOptions
): Promise<PublicKeyCredential> {
  const credential = await navigator.credentials.create({
    publicKey: options,
  });
  if (!credential) {
    throw new Error('Failed to create credential');
  }
  return credential as PublicKeyCredential;
}

/**
 * Get passkey credential for authentication
 */
export async function getPasskeyCredential(
  options: PublicKeyCredentialRequestOptions
): Promise<PublicKeyCredential> {
  const credential = await navigator.credentials.get({
    publicKey: options,
  });
  if (!credential) {
    throw new Error('Failed to get credential');
  }
  return credential as PublicKeyCredential;
}

/**
 * Serialize registration credential for API submission
 */
export function serializeRegistrationCredential(credential: PublicKeyCredential): object {
  const response = credential.response as AuthenticatorAttestationResponse;

  const serialized: any = {
    id: credential.id,
    rawId: bufferToBase64URL(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64URL(response.clientDataJSON),
      attestationObject: bufferToBase64URL(response.attestationObject),
    },
    clientExtensionResults: credential.getClientExtensionResults?.() || {},
  };

  // Add transports if available
  if (response.getTransports) {
    serialized.response.transports = response.getTransports();
  }

  // Add authenticator attachment if available
  if ('authenticatorAttachment' in credential) {
    serialized.authenticatorAttachment = (credential as any).authenticatorAttachment;
  }

  return serialized;
}

/**
 * Serialize authentication credential for API submission
 */
export function serializeAuthenticationCredential(credential: PublicKeyCredential): object {
  const response = credential.response as AuthenticatorAssertionResponse;

  const serialized: any = {
    id: credential.id,
    rawId: bufferToBase64URL(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bufferToBase64URL(response.clientDataJSON),
      authenticatorData: bufferToBase64URL(response.authenticatorData),
      signature: bufferToBase64URL(response.signature),
    },
    clientExtensionResults: credential.getClientExtensionResults?.() || {},
  };

  // Add userHandle if present
  if (response.userHandle) {
    serialized.response.userHandle = bufferToBase64URL(response.userHandle);
  }

  // Add authenticator attachment if available
  if ('authenticatorAttachment' in credential) {
    serialized.authenticatorAttachment = (credential as any).authenticatorAttachment;
  }

  return serialized;
}

/**
 * Get a friendly name suggestion for the passkey based on user agent
 */
export function suggestPasskeyName(): string {
  const ua = navigator.userAgent;

  // Try to detect browser first
  let browser = '';
  if (/Edg\//.test(ua)) {
    browser = 'Edge';
  } else if (/OPR\/|Opera/.test(ua)) {
    browser = 'Opera';
  } else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) {
    browser = 'Chrome';
  } else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) {
    browser = 'Safari';
  } else if (/Firefox\//.test(ua)) {
    browser = 'Firefox';
  }

  // Detect OS/Device
  let device = '';
  if (/iPhone/.test(ua)) {
    device = 'iPhone';
  } else if (/iPad/.test(ua)) {
    device = 'iPad';
  } else if (/Macintosh|Mac OS X/.test(ua)) {
    device = 'macOS';
  } else if (/Windows NT 10/.test(ua)) {
    device = 'Windows';
  } else if (/Windows/.test(ua)) {
    device = 'Windows';
  } else if (/Android/.test(ua)) {
    device = 'Android';
  } else if (/Linux/.test(ua)) {
    device = 'Linux';
  } else if (/CrOS/.test(ua)) {
    device = 'ChromeOS';
  }

  // Combine browser and device
  if (browser && device) {
    // For mobile devices, just use device name
    if (device === 'iPhone' || device === 'iPad' || device === 'Android') {
      return device;
    }
    return `${browser} on ${device}`;
  }

  if (device) return device;
  if (browser) return browser;

  return 'My Device';
}
