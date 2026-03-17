import pino from 'pino';
// --- LOG CAPTURE ---
export const logLines = [];
const MAX_LOGS = 500;
export function captureLog(level, msg) {
    const ts = new Date().toISOString();
    logLines.unshift({ ts, level, msg });
    if (logLines.length > MAX_LOGS)
        logLines.pop();
}
const logger = pino({
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            ignore: 'pid,hostname',
            translateTime: 'HH:MM:ss Z',
        },
    },
    level: process.env.LOG_LEVEL || 'info',
}, {
    write(msg) {
        try {
            const logEntry = JSON.parse(msg);
            const level = logEntry.level === 30 ? 'INFO' : logEntry.level === 40 ? 'WARN' : logEntry.level === 50 ? 'ERROR' : 'LOG';
            captureLog(level, logEntry.msg || msg);
            process.stdout.write(msg);
        }
        catch (e) {
            process.stdout.write(msg);
        }
    }
});
export default logger;
//# sourceMappingURL=logger.js.map