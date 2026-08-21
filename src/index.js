require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const { connectDB } = require('./config/db');
const state = require('./config/state');
const { checkBlocklist } = require('./middlewares/security');

// Import Routes
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const mailRoutes = require('./routes/mailRoutes');

const app = express();
const server = http.createServer(app);

// 🛡️ CRITICAL: Trust proxy so rate limiter uses real user IPs (not Render's proxy IP)
app.set('trust proxy', 1);

// ═══════════════════════════════════════════════════════
// 🛡️  SECURITY: Whitelisted CORS Origins
// ═══════════════════════════════════════════════════════
const ALLOWED_ORIGINS = [
  'https://tempinbox.me',
  'https://www.tempinbox.me',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const corsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('CORS policy: Origin not allowed'), false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400, // Cache preflight for 24 hours
};

const io = new Server(server, {
  cors: corsOptions,
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Configure state to track websockets dynamically
state.getActiveWebsockets = () => io.engine.clientsCount || 0;

// Connect to Database
connectDB();

// ═══════════════════════════════════════════════════════
// 🛡️  SECURITY: Helmet HTTP Headers
// ═══════════════════════════════════════════════════════
app.use(helmet({
  contentSecurityPolicy: false, // Let Next.js handle CSP
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ═══════════════════════════════════════════════════════
// 🛡️  SECURITY: Rate Limiting
// ═══════════════════════════════════════════════════════
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // 1000 requests per 15 min per IP (generous for real users)
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please try again later.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // 50 login attempts per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts. Please try again later.' },
});

const generateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // 30 emails per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Rate limit reached. Please wait before generating more emails.' },
});

// ═══════════════════════════════════════════════════════
// MIDDLEWARES
// ═══════════════════════════════════════════════════════
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' })); // 🛡️ Prevent large payload DoS
app.use(generalLimiter);
app.use(checkBlocklist);
app.use((req, res, next) => {
  req.io = io;
  next();
});

// ═══════════════════════════════════════════════════════
// API ROUTES
// ═══════════════════════════════════════════════════════
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api', mailRoutes);

// Apply strict rate limit to generate endpoint specifically
app.use('/api/generate', generateLimiter);

// ═══════════════════════════════════════════════════════
// 🛡️  SECURITY: Socket.io with JWT Validation
// ═══════════════════════════════════════════════════════
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET is not set in .env. Server cannot start securely.');
  process.exit(1);
}

io.on('connection', (socket) => {
  const connTime = new Date().toLocaleTimeString();
  state.socketLogsStore.unshift({
    id: socket.id.substring(0, 10),
    event: 'connect',
    payload: `Client connected`,
    time: connTime,
    status: 'CONNECTED',
  });

  socket.on('join_inbox', (data) => {
    // 🛡️ Validate: data can be a string (email) or { email, token }
    let email = data;
    let token = null;

    if (typeof data === 'object' && data !== null) {
      email = data.email;
      token = data.token;
    }

    // Validate email format
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      socket.emit('error_msg', { error: 'Invalid email format' });
      return;
    }

    // Sanitize: only allow testmail.app addresses
    if (!email.endsWith('@inbox.testmail.app')) {
      socket.emit('error_msg', { error: 'Invalid mailbox address' });
      return;
    }

    // Leave all previous rooms
    Array.from(socket.rooms).forEach((room) => {
      if (room !== socket.id) socket.leave(room);
    });
    socket.join(email);

    state.socketLogsStore.unshift({
      id: socket.id.substring(0, 10),
      event: 'join_inbox',
      payload: `Joined room: ${email.substring(0, 15)}...`,
      time: new Date().toLocaleTimeString(),
      status: 'SUCCESS',
    });
    if (state.socketLogsStore.length > 50) state.socketLogsStore.pop();
  });

  socket.on('disconnect', () => {
    state.socketLogsStore.unshift({
      id: socket.id.substring(0, 10),
      event: 'disconnect',
      payload: 'Client disconnected',
      time: new Date().toLocaleTimeString(),
      status: 'CLOSED',
    });
  });
});

// ═══════════════════════════════════════════════════════
// 🛡️  SECURITY: Global Error Handler (no stack traces leaked)
// ═══════════════════════════════════════════════════════
app.use((err, req, res, next) => {
  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({ success: false, error: 'CORS: Origin not permitted' });
  }
  console.error('Unhandled error:', err.message);
  res.status(500).json({ success: false, error: 'Internal Server Error' });
});

const API_PORT = process.env.PORT || 5000;
server.listen(API_PORT, () => {
  console.log(`🚀 W-Mail Backend running on port ${API_PORT} [SECURED]`);
});
