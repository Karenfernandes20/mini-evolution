import pino from 'pino';

export const logLines: any[] = [];
const MAX_LOGS = 1000;

function captureLog(level: string, msg: string, data: any = {}) {
  const ts = new Date();
  const summary = msg || (data.msg) || "N/A";
  logLines.unshift({ ts: ts.toISOString(), level, msg: summary });
  if (logLines.length > MAX_LOGS) logLines.pop();
}

const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    base: null,
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            ignore: 'pid,hostname',
            translateTime: 'HH:MM:ss Z',
        },
    },
});

// Intercept log calls to capture them in memory
const originalInfo = logger.info.bind(logger);
const originalError = logger.error.bind(logger);
const originalWarn = logger.warn.bind(logger);

(logger as any).info = (obj: any, msg?: string, ...args: any[]) => {
    const summary = typeof obj === 'string' ? obj : (msg || obj.msg || 'info');
    captureLog('INFO', summary);
    return originalInfo(obj, msg, ...args);
};

(logger as any).error = (obj: any, msg?: string, ...args: any[]) => {
    const summary = typeof obj === 'string' ? obj : (msg || obj.msg || 'error');
    captureLog('ERROR', summary);
    return originalError(obj, msg, ...args);
};

(logger as any).warn = (obj: any, msg?: string, ...args: any[]) => {
    const summary = typeof obj === 'string' ? obj : (msg || obj.msg || 'warn');
    captureLog('WARN', summary);
    return originalWarn(obj, msg, ...args);
};

export default logger;
