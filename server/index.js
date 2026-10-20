import 'dotenv/config';
import { createServer } from 'node:http';
import app from './app.js';
import { attachRealtimeChat } from './realtime/chat-hub.js';

const PORT = Number(process.env.PORT || 3021);
const HOST = process.env.HOST || '127.0.0.1';

const server = createServer(app);
attachRealtimeChat(server);

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`API port ${PORT} is already in use. Choose another PORT in .env and restart both API and Vite.`);
  } else {
    console.error('Unable to start API:', error);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Smart Real Estate API running on http://${HOST}:${PORT}`);
});
