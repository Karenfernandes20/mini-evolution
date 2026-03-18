const statusMap = {
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
export const normalizeApiStatus = (status) => {
    if (!status)
        return 'DISCONNECTED';
    return statusMap[status] || 'ERROR';
};
export const buildApiResponse = ({ success, status, instance, qrcode = null, message, }) => ({
    success,
    status: normalizeApiStatus(status),
    qrcode: qrcode ?? null,
    instance: instance ?? '',
    ...(message ? { message } : {}),
});
//# sourceMappingURL=api-response.js.map