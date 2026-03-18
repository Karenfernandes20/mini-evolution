export type ApiStatus = 'CONNECTED' | 'DISCONNECTED' | 'QRCODE' | 'ERROR';

export interface StandardApiResponse {
  success: boolean;
  status: ApiStatus;
  qrcode: string | null;
  instance: string;
  message?: string;
}

const statusMap: Record<string, ApiStatus> = {
  connected: 'CONNECTED',
  disconnected: 'DISCONNECTED',
  connecting: 'DISCONNECTED',
  qrcode: 'QRCODE',
  error: 'ERROR',
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED',
  QRCODE: 'QRCODE',
  ERROR: 'ERROR',
};

export const normalizeApiStatus = (status?: string | null): ApiStatus => {
  if (!status) return 'DISCONNECTED';
  return statusMap[status] || 'ERROR';
};

export const buildApiResponse = ({
  success,
  status,
  instance,
  qrcode = null,
  message,
}: {
  success: boolean;
  status?: string | null;
  instance?: string | null;
  qrcode?: string | null;
  message?: string;
}): StandardApiResponse => ({
  success,
  status: normalizeApiStatus(status),
  qrcode: qrcode ?? null,
  instance: instance ?? '',
  ...(message ? { message } : {}),
});
