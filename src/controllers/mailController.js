const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const InboxModel = require('../models/Inbox');
const UserModel = require('../models/User');
const state = require('../config/state');
const { getMongoStatus } = require('../config/db');

// 🛡️ SECURITY: Email validation regex
const VALID_TESTMAIL_REGEX = /^[a-z0-9]+\.[a-z0-9]+@inbox\.testmail\.app$/i;
const SAFE_STRING_REGEX = /^[a-zA-Z0-9.@_-]+$/;

const generateRandomString = (length) => {
  // 🛡️ Use crypto-safe random instead of Math.random
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

    // 🛡️ No daily limits — user requested unlimited generation
    // Rate limiting is handled at the Express middleware level

    const namespace = process.env.TESTMAIL_NAMESPACE || '3xeds';
    const randomStr = generateRandomString(8);
    const email = `${namespace}.${randomStr}@inbox.testmail.app`;

    state.mailCache.set(`account:${email}`, Date.now().toString());

    const inboxData = {
      email,
      createdAt: new Date().toISOString(),
      messagesCount: 0,
      clientIp: req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '127.0.0.1',
    };
    state.activeInboxesStore.set(email, inboxData);

    if (isMongoConnected) {
      await InboxModel.create({
        email,
        clientIp: inboxData.clientIp,
        messagesCount: 0,
      });
    }

    res.json({ success: true, email, ttl: 7200, mongoConnected: isMongoConnected, createdAt: new Date() });
  } catch (error) {
    console.error('Generate email error:', error.message);
    res.status(500).json({ success: false, error: 'Failed to generate email' });
  }
};

const getMessages = async (req, res) => {
  try {
    const email = req.params.email;

    // 🛡️ SECURITY: Input validation
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ success: false, error: 'Email parameter required' });
    }

    // 🛡️ SECURITY: Strict format validation
    if (!SAFE_STRING_REGEX.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid characters in email' });
    }

    if (!VALID_TESTMAIL_REGEX.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }

    // 🛡️ SECURITY: Max length check
    if (email.length > 100) {
      return res.status(400).json({ success: false, error: 'Email too long' });
    }

    const isMongoConnected = getMongoStatus();
    const exists = state.mailCache.has(`account:${email}`);
    if (!exists && !isMongoConnected) {
      return res.status(404).json({ success: false, error: 'Inbox not found or expired' });
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

    const testmailUrl = `https://api.testmail.app/api/json?apikey=${encodeURIComponent(apikey)}&namespace=${encodeURIComponent(namespace)}&tag=${encodeURIComponent(tag)}&livequery=true`;
    const response = await fetch(testmailUrl, {
      timeout: 15000, // 15 second timeout
    });

    if (!response.ok) {
      return res.status(502).json({ success: false, error: 'Mail service temporarily unavailable' });
    }

    const data = await response.json();

    let messages = [];
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

    // 🛡️ SECURITY: Input validation
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
