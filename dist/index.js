import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import logger from './utils/logger.js';
import instanceRoutes from './routes/instance.routes.js';
import messageRoutes from './routes/message.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import compatibilityRoutes from './routes/compatibility.routes.js';
import { authMiddleware } from './middlewares/auth.middleware.js';
import { instanceService } from './services/instance.service.js';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
// 1. Static Files (NO AUTH) - Move to the top to ensure they are handled first
const publicPath = path.resolve('public');
app.use(express.static(publicPath));
// 2. Health and Login (NO AUTH)
app.get('/health', (req, res) => res.json({ status: 'OK', timestamp: new Date() }));
app.post('/api/admin/login', (req, res) => {
    const { email, password } = req.body;
    if (email === env.ADMIN_EMAIL && password === env.ADMIN_PASS) {
        res.json({ token: env.ADMIN_TOKEN, success: true });
    }
    else {
        res.status(401).json({ error: 'Credenciais inválidas' });
    }
});
// 3. Admin Dashboard and Management (AUTH REQUIRED)
import { logLines } from './utils/logger.js';
app.get('/api/admin/logs', authMiddleware, (req, res) => {
    res.json(logLines);
});
app.get('/management/instances', authMiddleware, async (req, res) => {
    const instances = await instanceService.listInstances();
    res.json(instances);
});
app.post('/management/instances', authMiddleware, async (req, res) => {
    const { name, key: providedKey, token: providedToken } = req.body;
    const key = providedKey || name.replace(/\s+/g, '_').toLowerCase();
    const instance = await instanceService.createInstance(key, name, providedToken);
    res.json(instance);
});
app.delete('/management/instances/:key', authMiddleware, async (req, res) => {
    const { key } = req.params;
    await instanceService.deleteInstance(key);
    res.json({ success: true });
});
app.post('/management/instances/:key/disconnect', authMiddleware, async (req, res) => {
    const { key } = req.params;
    await instanceService.deleteInstance(key);
    await instanceService.startInstance(key);
    res.json({ success: true, message: 'Instância desconectada.' });
});
// 4. API Routes (AUTH REQUIRED)
app.use('/instance', authMiddleware, instanceRoutes);
app.use('/message', authMiddleware, messageRoutes);
app.use('/webhook', authMiddleware, webhookRoutes);
// 5. Compatibility Router (AUTH REQUIRED within compatibilityRoutes or via prefix)
// Need prefix to avoid catching everything with authMiddleware
app.use('/', authMiddleware, compatibilityRoutes);
// Last fallback for SPA (Frontend)
app.get('(.*)', (req, res, next) => {
    // If it was an API request that reached here, next() to error handler or 404
    if (req.path.startsWith('/api') || req.path.startsWith('/management') || req.path.startsWith('/instance')) {
        return next();
    }
    res.sendFile(path.join(publicPath, 'index.html'));
});
// Error Handler
app.use((err, req, res, next) => {
    logger.error(err);
    const status = err.status || 500;
    res.status(status).json({
        error: err.message || 'Internal Server Error',
        status
    });
});
const PORT = env.PORT || 3001;
app.listen(PORT, () => {
    logger.info(`🚀 Mini-Evolution Pro running on port ${PORT}`);
});
//# sourceMappingURL=index.js.map