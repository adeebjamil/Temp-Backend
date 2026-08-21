const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const InboxModel = require('../models/Inbox');
const UserModel = require('../models/User');
const state = require('../config/state');
const { getMongoStatus } = require('../config/db');

// 🛡️ SECURITY: Email validation regex
const VALID_TESTMAIL_REGEX = /^[a-z0-9]+\.[a-z0-9]+@inbox\.testmail\.app$/i;
const SAFE_STRING_REGEX = /^[a-zA-Z0-9.@_-]+$/;

// 🛡️ Abuse Detection Config
const ABUSE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_GENERATES_PER_WINDOW = 50;
const MAX_MESSAGES_PER_WINDOW = 200;
const LOCK_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours

const getClientIp = (req) => req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || '127.0.0.1';

const trackAbuse = (ip, type) => {
  const now = Date.now();
  let record = state.abuseTracker.get(ip);

  if (!record || (now - record.windowStart) > ABUSE_WINDOW_MS) {
    record = { generateCount: 0, messageCount: 0, windowStart: now };
  }

  if (type === 'generate') record.generateCount++;
  if (type === 'message') record.messageCount++;

  state.abuseTracker.set(ip, record);

  if (record.generateCount > MAX_GENERATES_PER_WINDOW) return 'SPAM_GENERATE';
  if (record.messageCount > MAX_MESSAGES_PER_WINDOW) return 'SPAM_MESSAGES';
  return null;
};

const lockInbox = async (email, ip, reason) => {
  const lockedUntil = new Date(Date.now() + LOCK_DURATION_MS);
  if (getMongoStatus()) {
    await InboxModel.updateOne({ email }, {
      status: 'LOCKED',
      lockedUntil,
      lockReason: reason,
    });
  }
  // Log the abuse event
  state.socketLogsStore.unshift({
    id: 'SYSTEM',
    event: 'ABUSE_DETECTED',
    payload: `Locked ${email.substring(0, 20)}... | IP: ${ip} | Reason: ${reason}`,
    time: new Date().toLocaleTimeString(),
    status: 'LOCKED',
  });
  if (state.socketLogsStore.length > 50) state.socketLogsStore.pop();
};

const generateRandomString = (length) => {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomValues = new Uint32Array(length);
  require('crypto').getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length];
  }
  return result;
};

const generateEmail = async (req, res) => {
  try {
    const isMongoConnected = getMongoStatus();
    const clientIp = getClientIp(req);

    // 🛡️ Abuse Detection
    const abuseType = trackAbuse(clientIp, 'generate');
    if (abuseType) {
      return res.status(429).json({
        success: false,
        error: 'ABUSE_DETECTED',
        message: 'Suspicious activity detected. Your access has been temporarily restricted.',
      });
    }

    const namespace = process.env.TESTMAIL_NAMESPACE || '3xeds';
    const randomStr = generateRandomString(8);
    const email = `${namespace}.${randomStr}@inbox.testmail.app`;

    state.mailCache.set(`account:${email}`, Date.now().toString());

    const inboxData = {
      email,
      createdAt: new Date().toISOString(),
      messagesCount: 0,
      clientIp,
    };
    state.activeInboxesStore.set(email, inboxData);

    if (isMongoConnected) {
      await InboxModel.create({
        email,
        clientIp,
        messagesCount: 0,
        status: 'ACTIVE',
      });
    }

    res.json({ success: true, email, ttl: 300, mongoConnected: isMongoConnected, createdAt: new Date() });
  } catch (error) {
    console.error('Generate email error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to generate email' });
  }
};

const getMessages = async (req, res) => {
  try {
    const email = req.params.email;
    const clientIp = getClientIp(req);

    // 🛡️ SECURITY: Input validation
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, error: 'Email parameter required' });
    }

    if (!SAFE_STRING_REGEX.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid characters in email' });
    }

    if (!VALID_TESTMAIL_REGEX.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }

    if (email.length > 100) {
      return res.status(400).json({ success: false, error: 'Email too long' });
    }

    // 🛡️ Abuse Detection
    const abuseType = trackAbuse(clientIp, 'message');
    if (abuseType) {
      await lockInbox(email, clientIp, abuseType);
      return res.status(429).json({
        success: false,
        error: 'INBOX_LOCKED',
        message: 'Your inbox has been locked for 24 hours due to suspicious activity.',
      });
    }

    // 🛡️ Check if inbox is locked
    const isMongoConnected = getMongoStatus();
    if (isMongoConnected) {
      const inboxDoc = await InboxModel.findOne({ email });
      if (inboxDoc && inboxDoc.status === 'LOCKED') {
        if (inboxDoc.lockedUntil && new Date() < inboxDoc.lockedUntil) {
          return res.status(403).json({
            success: false,
            error: 'INBOX_LOCKED',
            message: `Inbox locked until ${inboxDoc.lockedUntil.toISOString()}. Contact admin.`,
          });
        } else {
          // Lock expired, auto-unlock
          await InboxModel.updateOne({ email }, { status: 'ACTIVE', lockedUntil: null, lockReason: null });
        }
      }
    }

    const exists = state.mailCache.has(`account:${email}`);
    if (!exists && !isMongoConnected) {
      return res.status(404).json({ success: false, error: 'Inbox not found or expired' });
    }

    // 🛡️ SMART CACHE: Check if messages were fetched within the last 10 seconds
    const cacheKey = `msgs:${email}`;
    const cachedMessages = state.mailCache.get(cacheKey);
    if (cachedMessages) {
      return res.json({ success: true, count: cachedMessages.length, messages: cachedMessages, cached: true });
    }

    const localPart = email.split('@')[0];
    const parts = localPart.split('.');
    if (parts.length !== 2) {
      return res.status(400).json({ success: false, error: 'Invalid email structure' });
    }
    const [namespace, tag] = parts;

    const apikey = process.env.TESTMAIL_API_KEY;
    if (!apikey) {
      return res.status(500).json({ success: false, error: 'Mail service configuration error' });
    }

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const testmailUrl = `https://api.testmail.app/api/json?apikey=${encodeURIComponent(apikey)}&namespace=${encodeURIComponent(namespace)}&tag=${encodeURIComponent(tag)}`;
    const response = await fetch(testmailUrl, {
      timeout: 10000,
    });

    let messages = [];

    if (response.ok) {
      const data = await response.json();
      if (data && data.emails) {
        messages = data.emails.map((msg) => ({
          id: msg.id,
          sender: msg.from,
          subject: msg.subject || '(No Subject)',
          text: msg.text || '',
          html: msg.html || '',
          receivedAt: new Date(msg.date),
        }));
      }
      // Cache messages for 10 seconds to drastically reduce external API quota consumption
      state.mailCache.set(cacheKey, messages, 10);
    } else if (response.status === 429) {
      // 🛡️ Testmail rate limited on their free tier: gracefully return empty/cached list instead of 502 error
      console.warn(`⚠️ Testmail API quota exceeded (429). Serving fallback for ${email}.`);
      messages = cachedMessages || [];
    } else {
      console.warn(`⚠️ Testmail returned status ${response.status} for ${email}`);
      messages = cachedMessages || [];
    }

    if (state.activeInboxesStore.has(email)) {
      const inbox = state.activeInboxesStore.get(email);
      inbox.messagesCount = messages.length;
      state.activeInboxesStore.set(email, inbox);
    }

    if (isMongoConnected) {
      await InboxModel.updateOne({ email }, { messagesCount: messages.length });
    }

    res.json({ success: true, count: messages.length, messages });
  } catch (error) {
    console.error('Get messages error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to fetch messages' });
  }
};

const deleteEmail = async (req, res) => {
  try {
    const email = req.params.email;

    if (!email || !SAFE_STRING_REGEX.test(email) || !VALID_TESTMAIL_REGEX.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }

    state.mailCache.del(`account:${email}`);
    state.activeInboxesStore.delete(email);

    if (getMongoStatus()) {
      await InboxModel.deleteOne({ email });
    }

    res.json({ success: true, message: 'Inbox deleted' });
  } catch (error) {
    console.error('Delete email error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to delete inbox' });
  }
};

module.exports = { generateEmail, getMessages, deleteEmail };
