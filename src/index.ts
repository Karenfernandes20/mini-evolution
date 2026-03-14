import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import logger from './utils/logger.js';
import instanceRoutes from './routes/instance.routes.js';
import messageRoutes from './routes/message.routes.js';
import webhookRoutes from './routes/webhook.routes.js';
import compatibilityRoutes from './routes/compatibility.routes.js';
import { authMiddleware } from './middlewares/auth.middleware.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Health Check
app.get('/health', (req, res) => res.json({ status: 'OK', timestamp: new Date() }));

// Compatibility Routes (Support for old system endpoints)
app.use('/', authMiddleware, compatibilityRoutes);

// Structured Routes
app.use('/instance', authMiddleware, instanceRoutes);
app.use('/message', authMiddleware, messageRoutes);
app.use('/webhook', authMiddleware, webhookRoutes);

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
});
