import cors from 'cors';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { ZodError } from 'zod';
import { env } from './config/env.js';
import { authMiddleware } from './middlewares/auth.middleware.js';
import instanceRoutes from './routes/instance.routes.js';
import messageRoutes from './routes/message.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import compatibilityRoutes from './routes/compatibility.routes.js';
import { instanceService } from './services/instance.service.js';
import logger, { logLines } from './utils/logger.js';
import { buildApiResponse } from './utils/api-response.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicPath = path.resolve(__dirname, '..', 'public');
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use((req, res, next) => {
    const startedAt = Date.now();
    const originalJson = res.json.bind(res);
    res.json = (body) => {
        logger.info({
            route: req.originalUrl,
            method: req.method,
            body: req.body,
            instance: req.params.instance || req.body?.instance || null,
            responseBody: body,
            durationMs: Date.now() - startedAt,
        }, 'HTTP response sent');
        return originalJson(body);
    };
    logger.info({
        route: req.originalUrl,
        method: req.method,
        body: req.body,
        instance: req.params.instance || req.body?.instance || null,
    }, 'HTTP request received');
    return next();
});
app.use(express.static(publicPath));
app.get('/health', (req, res) => {
    res.json({
        success: true,
        status: 'CONNECTED',
        qrcode: null,
        instance: 'system',
        message: 'Mini-Evolution is healthy',
        timestamp: new Date().toISOString(),
    });
});
app.post('/api/admin/login', (req, res) => {
    const { email, password } = req.body ?? {};
    if (email === env.ADMIN_EMAIL && password === env.ADMIN_PASS) {
        return res.json({
            success: true,
            status: 'CONNECTED',
            qrcode: null,
            instance: 'admin',
            message: 'Login successful',
            token: env.GLOBAL_API_KEY,
        });
    }
    return res.status(401).json(buildApiResponse({
        success: false,
        status: 'ERROR',
        instance: 'admin',
        message: 'Credenciais inválidas',
    }));
});
app.get('/api/admin/logs', authMiddleware, (req, res) => {
    res.json({
        success: true,
        status: 'CONNECTED',
        qrcode: null,
        instance: 'system',
        data: logLines,
    });
});
app.get('/management/instances', authMiddleware, async (req, res) => {
    const instances = await instanceService.listInstances();
    res.json({
        success: true,
        status: 'CONNECTED',
        qrcode: null,
        instance: 'all',
        data: instances,
    });
});
app.post('/management/instances', authMiddleware, async (req, res) => {
    const { name, key: providedKey, token: providedToken } = req.body;
    const key = (providedKey || name || '').replace(/\s+/g, '_').toLowerCase();
    const instance = await instanceService.ensureInstance(key, name, providedToken);
    res.json({
        success: true,
        status: 'DISCONNECTED',
        qrcode: null,
        instance: instance.key,
        data: instance,
    });
});
app.delete('/management/instances/:key', authMiddleware, async (req, res) => {
    const { key } = req.params;
    await instanceService.deleteInstance(key);
    res.json(buildApiResponse({
        success: true,
        status: 'DISCONNECTED',
        instance: key,
        message: 'Instance deleted successfully',
    }));
});
app.post('/management/instances/:key/disconnect', authMiddleware, async (req, res) => {
    const { key } = req.params;
    await instanceService.deleteInstance(key);
    await instanceService.ensureInstance(key);
    await instanceService.startInstance(key);
    const data = await instanceService.waitForQrCode(key, 15000);
    res.json(buildApiResponse({
        success: true,
        status: data?.qrBase64 ? 'QRCODE' : data?.status,
        qrcode: data?.qrBase64 ?? null,
        instance: key,
        message: 'Instance disconnected and restarted successfully',
    }));
});
app.use('/instance', authMiddleware, instanceRoutes);
app.use('/message', authMiddleware, messageRoutes);
app.use('/webhook', authMiddleware, webhookRoutes);
app.use('/', authMiddleware, compatibilityRoutes);
app.use((req, res) => {
    res.status(404).json(buildApiResponse({
        success: false,
        status: 'ERROR',
        instance: typeof req.params.instance === 'string' ? req.params.instance : '',
        message: `Route not found: ${req.method} ${req.originalUrl}`,
    }));
});
app.use((err, req, res, next) => {
    if (next) {
        void next;
    }
    logger.error({ err, route: req.originalUrl, body: req.body }, 'Unhandled application error');
    if (err instanceof ZodError) {
        return res.status(400).json(buildApiResponse({
            success: false,
            status: 'ERROR',
            instance: req.params.instance || req.body?.instance || '',
            message: err.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
        }));
    }
    const statusCode = err?.status || err?.statusCode || 500;
    return res.status(statusCode).json(buildApiResponse({
        success: false,
        status: 'ERROR',
        instance: req.params.instance || req.body?.instance || '',
        message: err?.message || 'Internal Server Error',
    }));
});
const PORT = Number(env.PORT || 3000);
const server = app.listen(PORT, () => {
    logger.info({ port: PORT, pid: process.pid }, 'Mini-Evolution running');
    instanceService.initAllInstances().catch((error) => {
        logger.error({ err: error }, 'Failed to initialize instances on boot');
    });
});
const shutdown = (signal) => {
    logger.info({ signal }, 'Graceful shutdown started');
    server.close(() => {
        logger.info('HTTP server closed successfully');
        process.exit(signal === 'FATAL' ? 1 : 0);
    });
    setTimeout(() => {
        logger.warn('Forcing shutdown after timeout');
        process.exit(1);
    }, 10000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
    logger.error({ err: reason }, 'Unhandled promise rejection');
    shutdown('FATAL');
});
process.on('uncaughtException', (error) => {
    logger.error({ err: error }, 'Uncaught exception');
    shutdown('FATAL');
});
//# sourceMappingURL=index.js.map