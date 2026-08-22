const jwt = require('jsonwebtoken');
const UserModel = require('../models/User');

// 🛡️ SECURITY: No hardcoded fallbacks — must be set in .env
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;

if (!JWT_SECRET) {
  console.error('❌ FATAL: JWT_SECRET is not configured in .env');
  process.exit(1);
}

if (!ADMIN_EMAIL) {
  console.error('❌ FATAL: ADMIN_EMAIL is not configured in .env');
  process.exit(1);
}

const verifyAdmin = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    if (decoded.email.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      // 🛡️ SECURITY: Generic error — don't reveal which email is admin
      return res.status(403).json({ success: false, error: 'Forbidden: Insufficient privileges' });
    }

    req.adminUser = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Token expired. Please login again.' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }
    return res.status(401).json({ success: false, error: 'Authentication failed' });
  }
};

const verifyUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split(' ')[1];

    // 🛡️ SECURITY: Validate token length before jwt.verify to prevent DoS
    if (token.length > 2000) {
      return res.status(401).json({ success: false, error: 'Invalid token format' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);

    // Check User Ban/Deactivation status with case-insensitive query
    if (decoded?.email) {
      const user = await UserModel.findOne({
        email: { $regex: new RegExp(`^${decoded.email.trim()}$`, 'i') }
      });
      if (user) {
        if (user.status === 'BANNED') {
          return res.status(403).json({ success: false, error: 'ACCOUNT_BANNED', message: 'Your account has been suspended by administrator.' });
        }
        if (user.status === 'DEACTIVATED') {
          return res.status(403).json({ success: false, error: 'ACCOUNT_DEACTIVATED', message: 'Your account has been deactivated by administrator.' });
        }
      }
    }

    req.user = decoded;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, error: 'Token expired. Please login again.' });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, error: 'Invalid token' });
    }
    return res.status(401).json({ success: false, error: 'Authentication failed' });
  }
};

module.exports = { verifyAdmin, verifyUser, JWT_SECRET, ADMIN_EMAIL };
