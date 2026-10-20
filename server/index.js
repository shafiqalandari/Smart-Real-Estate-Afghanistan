import 'dotenv/config';
import { createServer } from 'node:http';
import app from './app.js';
import { attachRealtimeChat } from './realtime/chat-hub.js';

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '127.0.0.1';

const server = createServer(app);
attachRealtimeChat(server);

server.listen(PORT, HOST, () => {
  console.log(`Smart Real Estate API running on http://${HOST}:${PORT}`);
});
