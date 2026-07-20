import dotenv from 'dotenv';
import path from 'path';

// Load env vars before anything else
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Prevent Express server from binding to a port (supertest handles HTTP)
process.env.VERCEL = '1';
