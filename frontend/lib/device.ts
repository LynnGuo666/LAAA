/**
 * Device Token Management
 *
 * Generates and manages a unique device token stored in localStorage.
 * Used for device identification and stricter device verification.
 */

const DEVICE_TOKEN_KEY = 'laaa_device_token';

/**
 * Generate a random device token (32 bytes, base64url encoded)
 */
function generateDeviceToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  // Convert to base64url
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Get the device token from localStorage, or generate a new one if not present
 */
export function getDeviceToken(): string {
  if (typeof window === 'undefined') {
    // Server-side rendering - return empty string
    return '';
  }

  let token = localStorage.getItem(DEVICE_TOKEN_KEY);
  if (!token) {
    token = generateDeviceToken();
    localStorage.setItem(DEVICE_TOKEN_KEY, token);
  }
  return token;
}

/**
 * Clear the device token (useful for testing or security purposes)
 */
export function clearDeviceToken(): void {
  if (typeof window === 'undefined') {
    return;
  }
  localStorage.removeItem(DEVICE_TOKEN_KEY);
}

/**
 * Check if device token exists
 */
export function hasDeviceToken(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return localStorage.getItem(DEVICE_TOKEN_KEY) !== null;
}
