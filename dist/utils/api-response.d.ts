export type ApiStatus = 'CONNECTED' | 'DISCONNECTED' | 'QRCODE' | 'ERROR';
export interface StandardApiResponse {
    success: boolean;
    status: ApiStatus;
    qrcode: string | null;
    instance: string;
    message?: string;
}
export declare const normalizeApiStatus: (status?: string | null) => ApiStatus;
export declare const buildApiResponse: ({ success, status, instance, qrcode, message, }: {
    success: boolean;
    status?: string | null;
    instance?: string | null;
    qrcode?: string | null;
    message?: string;
}) => StandardApiResponse;
