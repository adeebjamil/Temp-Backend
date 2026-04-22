const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const NodeCache = require('node-cache');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*', // Allow Next.js frontend in development
  },
});

app.use(cors());
app.use(express.json());

// In-Memory Cache Setup
const mailCache = new NodeCache({ stdTTL: 7200, checkperiod: 120 });

// Helper to generate random string
const generateRandomString = (length) => {
  return Math.random().toString(36).substring(2, length + 2);
};

// ======= API ROUTES =======

// 1. Generate a new random email address using Testmail.app format
app.post('/api/generate', (req, res) => {
  try {
    // Uses the namespace from your Testmail.app account (e.g. 3xeds)
    const namespace = process.env.TESTMAIL_NAMESPACE || '3xeds';
    const randomStr = generateRandomString(8);
    
    // Testmail format: {namespace}.{tag}@inbox.testmail.app
    const email = `${namespace}.${randomStr}@inbox.testmail.app`;
    
    mailCache.set(`account:${email}`, Date.now().toString());

    res.json({ success: true, email, ttl: 7200, createdAt: new Date() });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// 2. Fetch messages for an email address from Testmail.app API
app.get('/api/messages/:email', async (req, res) => {
  try {
    const email = req.params.email;
    if (!email) return res.status(400).json({ error: 'Email required' });

    // Validate if it's a Testmail address
    if (!email.includes('@inbox.testmail.app')) {
      return res.status(400).json({ error: 'Not a valid Testmail address' });
    }

    const exists = mailCache.has(`account:${email}`);
    if (!exists) return res.status(404).json({ error: 'Account expired or does not exist' });

    // Extract namespace and tag
    const localPart = email.split('@')[0];
    const [namespace, tag] = localPart.split('.');

    const apikey = process.env.TESTMAIL_API_KEY;
    if (!apikey) {
      return res.status(500).json({ error: 'TESTMAIL_API_KEY is not set in backend .env' });
    }

    // Set headers to strictly prevent caching
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Call Testmail.app JSON API (livequery=true forces fresh results)
    const testmailUrl = `https://api.testmail.app/api/json?apikey=${apikey}&namespace=${namespace}&tag=${tag}&livequery=true`;
    
    // Native fetch (requires Node 18+)
    const response = await fetch(testmailUrl);
    const data = await response.json();

    let messages = [];
    if (data && data.emails) {
      messages = data.emails.map(msg => ({
        id: msg.id,
        sender: msg.from,
        subject: msg.subject || '(No Subject)',
        text: msg.text || '',
        html: msg.html || '',
        receivedAt: new Date(msg.date)
      }));
    }

    res.json({ success: true, count: messages.length, messages });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// 3. Delete an inbox manually
app.delete('/api/delete/:email', (req, res) => {
  try {
    const email = req.params.email;
    mailCache.del(`account:${email}`);
    res.json({ success: true, message: 'Inbox deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
});

// ======= WEBSOCKETS (Kept for frontend compatibility) =======
io.on('connection', (socket) => {
  console.log(`Socket connected: ${socket.id}`);
  socket.on('join_inbox', (email) => {
    Array.from(socket.rooms).forEach(room => {
      if (room !== socket.id) socket.leave(room);
    });
    socket.join(email);
    console.log(`Socket ${socket.id} joined inbox: ${email}`);
  });
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);
  });
});

const API_PORT = process.env.PORT || 5000;
server.listen(API_PORT, () => {
  console.log(`Backend API running on port ${API_PORT} via Testmail.app Integration`);
});
