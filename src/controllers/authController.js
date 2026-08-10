const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const UserModel = require('../models/User');
const AuditLogModel = require('../models/AuditLog');
const { JWT_SECRET, ADMIN_EMAIL } = require('../middlewares/auth');
const state = require('../config/state');
const { getMongoStatus } = require('../config/db');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const googleLogin = async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ success: false, error: 'Google credential is required' });

    let email, name, photoURL;

    try {
      const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      email = payload.email;
      name = payload.name;
      photoURL = payload.picture;
    } catch (verifyError) {
      console.error('Google token verification failed:', verifyError);
      return res.status(401).json({ success: false, error: 'Invalid Google token' });
    }

    const isAdmin = email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    const role = isAdmin ? 'SUPERADMIN' : 'USER';

    const bcryptSalt = await bcrypt.genSalt(10);
    const bcryptHash = await bcrypt.hash(email + '_wmail_session', bcryptSalt);

    const isMongoConnected = getMongoStatus();
    let dbUser = null;
    let multiDeviceDetected = false;

    if (isMongoConnected) {
      const clientIp = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || req.connection?.remoteAddress || '127.0.0.1';
      const existingUser = await UserModel.findOne({ email });
      
      if (existingUser) {
        if (existingUser.status === 'DEACTIVATED' || existingUser.status === 'BANNED') {
          return res.status(403).json({ success: false, error: `Account is ${existingUser.status.toLowerCase()}` });
        }
        if (existingUser.lastIp && existingUser.lastIp !== clientIp) {
          multiDeviceDetected = true;
        }
      }

      dbUser = await UserModel.findOneAndUpdate(
        { email },
        { email, name, photoURL, role, lastLogin: new Date(), lastIp: clientIp },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      await AuditLogModel.create({
        user: email,
        role,
        bcryptSalt: bcryptSalt.substring(0, 18) + '...',
        tokenExp: '7 Days',
        status: 'VERIFIED',
      });
    }

    const token = jwt.sign(
      {
        email,
        name: name || (isAdmin ? 'Adeeb Jamil' : 'Google User'),
        role,
        bcryptHashSignature: bcryptHash.substring(0, 20),
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    state.jwtAuditLogsStore.unshift({
      user: email,
      role,
      bcryptSalt: bcryptSalt.substring(0, 18) + '...',
      tokenExp: '7 Days',
      status: 'VERIFIED',
      timestamp: new Date().toISOString(),
    });

    res.json({
      success: true,
      token,
      mongoConnected: isMongoConnected,
      multiDeviceDetected,
      user: {
        email,
        name: name || (isAdmin ? 'Adeeb Jamil' : 'Google User'),
        photoURL: photoURL || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80',
        role,
        isAdmin,
        createdAt: dbUser && dbUser.createdAt ? dbUser.createdAt : new Date().toISOString(),
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Authentication failed' });
  }
};

const deleteAccount = async (req, res) => {
  try {
    const email = req.user.email;
    const isMongoConnected = getMongoStatus();

    if (isMongoConnected) {
      await UserModel.findOneAndDelete({ email });
      await AuditLogModel.create({
        user: email,
        role: req.user.role,
        bcryptSalt: 'N/A',
        tokenExp: '0',
        status: 'DELETED',
      });
    }
    
    res.json({ success: true, message: 'Account deleted successfully' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ success: false, error: 'Failed to delete account' });
  }
};

module.exports = { googleLogin, deleteAccount };
