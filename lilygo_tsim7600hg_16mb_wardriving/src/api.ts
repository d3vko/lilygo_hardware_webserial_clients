const LOGIN_URL = import.meta.env['VITE_LOGIN_URL'] as string | undefined;
const REGISTER_URL = import.meta.env['VITE_REGISTER_URL'] as string | undefined;
const RESET_URL = import.meta.env['VITE_RESET_URL'] as string | undefined;
const UPLOAD_URL = import.meta.env['VITE_UPLOAD_URL'] as string | undefined;
const REFRESH_URL = import.meta.env['VITE_TOKEN_REFRESH_URL'] as string | undefined;
const DEVICE_SOURCE_WIFI_BLE = import.meta.env['VITE_DEVICE_SOURCE_WIFI_BLE'] as string | undefined;
const DEVICE_SOURCE_LTE = import.meta.env['VITE_DEVICE_SOURCE_LTE'] as string | undefined;

export class ApiConfigError extends Error {}

function requireEnv(value: string | undefined, name: string): string {
  if (!value) throw new ApiConfigError(`API URL not configured: ${name}`);
  return value;
}

export interface LoginResponse {
  access: string;
  refresh: string;
  username: string;
}

export interface RegisterResponse {
  user: { id: number; username: string; email: string };
  tokens: { access: string; refresh: string };
}

export interface ResetResponse {
  detail: string;
}

export function parseApiError(data: Record<string, unknown>): string {
  if (typeof data['detail'] === 'string') return data['detail'];
  if (Array.isArray(data['non_field_errors']) && data['non_field_errors'].length > 0)
    return String(data['non_field_errors'][0]);
  return Object.values(data)
    .flatMap((v) => (Array.isArray(v) ? v : [v]))
    .map(String)
    .join(' ');
}

export async function login(username: string, password: string): Promise<LoginResponse> {
  const url = requireEnv(LOGIN_URL, 'VITE_LOGIN_URL');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(parseApiError(data));
  return data as unknown as LoginResponse;
}

export async function register(
  username: string,
  email: string,
  password: string,
  passwordConfirm: string,
): Promise<RegisterResponse> {
  const url = requireEnv(REGISTER_URL, 'VITE_REGISTER_URL');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email, password, password_confirm: passwordConfirm }),
  });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(parseApiError(data));
  return data as unknown as RegisterResponse;
}

export async function requestPasswordReset(email: string): Promise<ResetResponse> {
  const url = requireEnv(RESET_URL, 'VITE_RESET_URL');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(parseApiError(data));
  return data as unknown as ResetResponse;
}

export async function refreshToken(refresh: string): Promise<{ access: string }> {
  const url = requireEnv(REFRESH_URL, 'VITE_TOKEN_REFRESH_URL');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh }),
  });
  if (!response.ok) throw new Error('Token refresh failed');
  return response.json() as Promise<{ access: string }>;
}

export async function uploadCsv(
  type: 'lte' | 'wifi' | 'ble',
  file: Blob,
  filename: string,
  accessToken: string,
): Promise<Response> {
  const url = requireEnv(UPLOAD_URL, 'VITE_UPLOAD_URL');
  const deviceSource =
    type === 'lte'
      ? requireEnv(DEVICE_SOURCE_LTE, 'VITE_DEVICE_SOURCE_LTE')
      : requireEnv(DEVICE_SOURCE_WIFI_BLE, 'VITE_DEVICE_SOURCE_WIFI_BLE');
  const formData = new FormData();
  formData.append('files', file, filename);
  formData.append('device_source', deviceSource);
  return fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: formData,
  });
}
