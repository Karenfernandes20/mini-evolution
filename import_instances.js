
import { pool } from '../integrai/server/database.js';
import fs from 'fs';
import path from 'path';

const instances = JSON.parse(fs.readFileSync('./instances.json', 'utf-8'));
const companyId = 1; // Ajuste se necessário

async function importInstances() {
    console.log(`🚀 Iniciando importação de ${instances.length} instâncias para a empresa ${companyId}...`);

    for (const inst of instances) {
        try {
            // Check if column 'type' exists
            const hasType = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name = 'company_instances' AND column_name = 'type' LIMIT 1");

            if (hasType.rows.length > 0) {
                await pool.query(
                    `INSERT INTO company_instances (company_id, name, instance_key, api_key, status, type, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5, 'local', NOW(), NOW())
                     ON CONFLICT (instance_key) DO UPDATE 
                     SET api_key = EXCLUDED.api_key, type = 'local'`,
                    [companyId, inst.key, inst.key, inst.token, 'disconnected']
                );
            } else {
                await pool.query(
                    `INSERT INTO company_instances (company_id, name, instance_key, api_key, status, created_at, updated_at)
                     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                     ON CONFLICT (instance_key) DO UPDATE 
                     SET api_key = EXCLUDED.api_key`,
                    [companyId, inst.key, inst.key, inst.token, 'disconnected']
                );
            }
        } catch (e) {
            console.error(`Erro ao importar ${inst.key}:`, e.message);
        }
    }

    console.log("✅ Importação concluída!");
    process.exit();
}

importInstances();
