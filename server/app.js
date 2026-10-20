import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import handler from './routes/central-api.js';
import realEstateRouter from './routes/real-estate.js';
import { handleRealtimeSse } from './realtime/chat-hub.js';
import { pgPool, resolveStoragePath, verifyStorageSignature } from './central/database.js';

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-origin' } }));
const allowedOrigins=String(process.env.FRONTEND_ORIGINS||'').split(',').map(v=>v.trim()).filter(Boolean);
app.use(cors({ origin:(origin,cb)=>{if(!origin||!allowedOrigins.length||allowedOrigins.includes(origin))return cb(null,true);return cb(new Error('Origin not allowed by CORS'));}, credentials:true }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }));

app.get('/api/storage/:bucket/*', async (req, res) => {
  try {
    const bucket = req.params.bucket;
    const objectPath = String(req.params[0] || '');
    if (!verifyStorageSignature(bucket, objectPath, req.query.expires, req.query.sig)) return res.status(403).json({ error: 'Storage link expired or invalid.' });
    const file = resolveStoragePath(bucket, objectPath);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'File not found.' });
    return res.sendFile(path.resolve(file));
  } catch (error) {
    console.error('storage download', error);
    return res.status(500).json({ error: 'Unable to read file.' });
  }
});

app.get('/api/realtime/events', handleRealtimeSse);

app.get('/api/health/postgres', async (_req, res) => {
  try {
    const result = await pgPool().query('SELECT current_database() AS database_name, NOW() AS database_time');
    return res.json({ success: true, database: 'connected', databaseName: result.rows[0].database_name, databaseTime: result.rows[0].database_time });
  } catch (error) {
    console.error('postgres health', error);
    return res.status(503).json({ success: false, database: 'disconnected' });
  }
});

app.use('/api/real-estate', realEstateRouter);
app.all('/api/*', (req, res) => handler(req, res));
app.use((err,req,res,next)=>{console.error('Real estate API:',err);res.status(400).json({error:err.message||'خطای سرور'});});

export default app;
