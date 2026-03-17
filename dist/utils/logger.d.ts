import pino from 'pino';
export declare const logLines: any[];
export declare function captureLog(level: string, msg: string): void;
declare const logger: pino.Logger<never, boolean>;
export default logger;
