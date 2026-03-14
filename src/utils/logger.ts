import pino from 'pino';

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
});

export default logger;
