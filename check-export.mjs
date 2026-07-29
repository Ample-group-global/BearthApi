import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const p = new Pool({
  connectionString: "postgresql://postgres:idkniaxoQBYItcwPzEaXgIvnSWaSdKIy@reseau.proxy.rlwy.net:55600/BearthDev",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000
});
try {
  // All generation jobs
  const jobs = await p.query(`SELECT id, status, edition_size, created_at FROM nft_generation_jobs ORDER BY created_at DESC LIMIT 5`);
  console.log("Recent generation jobs:");
  jobs.rows.forEach(r => console.log(" ", JSON.stringify(r)));

  // Export jobs
  const exportTables = await p.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE '%export%'`);
  console.log("Export tables:", exportTables.rows.map(r => r.table_name).join(', ') || 'none');

  if (exportTables.rows.length > 0) {
    for (const { table_name } of exportTables.rows) {
      const ex = await p.query(`SELECT * FROM ${table_name} ORDER BY created_at DESC LIMIT 3`);
      console.log(`${table_name}:`, JSON.stringify(ex.rows));
    }
  }

  // Check ipfs_image_cid filled
  const cidCheck = await p.query(`SELECT COUNT(*) AS with_cid FROM nft_generated_items WHERE ipfs_image_cid IS NOT NULL`);
  console.log("Items with IPFS CID:", cidCheck.rows[0].with_cid);
} catch(e) {
  console.error("ERROR:", e.message);
} finally {
  await p.end();
}
