import 'dotenv/config';
import { z } from 'zod';
const envSchema = z.object({
    PORT: z.string().default('3000'),
    NODE_ENV: z.string().default('production'),
    DATABASE_URL: z.string().optional(),
    REDIS_URL: z.string().default('redis://localhost:6379'),
    GLOBAL_API_KEY: z.string().default('minievo-secret-key'),
    WEBHOOK_URL_BASE: z.string().optional(),
    INSTANCE_TOKEN_PREFIX: z.string().default('me_'),
    ADMIN_EMAIL: z.string().default('integraiempresa01@gmail.com'),
    ADMIN_PASS: z.string().default('Integr1234'),
    ADMIN_TOKEN: z.string().default('minievo-session-token-998877'),
});
const _env = envSchema.safeParse(process.env);
if (!_env.success) {
    const errors = _env.error.format();
    console.error('❌ Invalid environment variables:', JSON.stringify(errors, null, 2));
    // In production, we might want to proceed with defaults if possible, 
    // but for critical stuff we should still know.
    // throw new Error('Invalid environment variables'); 
}
export const env = _env.success ? _env.data : envSchema.parse({});
//# sourceMappingURL=env.js.map