import { config } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Pool } from 'pg';

config({ path: resolve(process.cwd(), '.env.local') });

const file = process.argv[2];
if (!file) {
  console.error('Usage: tsx db/migrate.ts <sql-file>');
  process.exit(1);
}

(async () => {
  const sql = readFileSync(resolve(process.cwd(), file), 'utf8');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log(`✓ Applied: ${file}`);
  } catch (e: any) {
    console.error(`✗ Failed: ${e.message}`);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
