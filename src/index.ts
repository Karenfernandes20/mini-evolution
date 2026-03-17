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

// Health Check
app.get('/health', (req, res) => res.json({ status: 'OK', timestamp: new Date() }));

// Admin Dashboard Routes (Compatiblity with old frontend)
app.post('/api/admin/login', (req, res) => {
    const { email, password } = req.body;
    if (email === env.ADMIN_EMAIL && password === env.ADMIN_PASS) {
        res.json({ token: env.ADMIN_TOKEN, success: true });
    } else {
        res.status(401).json({ error: 'Credenciais inválidas' });
    }
});

app.get('/api/admin/logs', authMiddleware, (req, res) => {
    // Basic placeholder for logs. Real implementation would use pino or a custom buffer.
    res.json([{ ts: new Date().toISOString(), level: 'INFO', msg: 'Logs requested from dashboard' }]);
});

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Management endpoints (Admin with token or API Key)
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
    const { key } = req.params as { key: string };
    await instanceService.deleteInstance(key);
    res.json({ success: true });
});

app.post('/management/instances/:key/disconnect', authMiddleware, async (req, res) => {
    const { key } = req.params as { key: string };
    await instanceService.deleteInstance(key); // Logout and clear
    await instanceService.startInstance(key); // Restart fresh
    res.json({ success: true, message: 'Instância desconectada.' });
});

// Structured Protected API Routes (for Integrai Integrations)
app.use('/instance', authMiddleware, instanceRoutes);
app.use('/message', authMiddleware, messageRoutes);
app.use('/webhook', authMiddleware, webhookRoutes);

// Compatibility Routes (Support for old system endpoints)
app.use('/', authMiddleware, compatibilityRoutes);

// Error Handler
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
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

  // Start all instances on boot in background to avoid blocking the health check
  instanceService.initAllInstances().catch((err: any) => {
    logger.error(err, 'Failed to auto-start instances during boot');
  });
});

