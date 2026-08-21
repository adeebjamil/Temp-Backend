const mongoose = require('mongoose');
const { loadBlocklist } = require('../middlewares/security');

let isMongoConnected = false;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/wmail';

const connectDB = () => {
  mongoose
    .connect(MONGODB_URI, { serverSelectionTimeoutMS: 3000 })
    .then(() => {
      isMongoConnected = true;
      // 🛡️ SECURITY: Don't log connection string (contains credentials)
      console.log('✅ MongoDB connected successfully');
      mongoose.connection.once('open', loadBlocklist);
    })
    .catch((err) => {
      isMongoConnected = false;
      console.warn('⚠️ MongoDB offline. Running in hybrid memory-cache mode.');
    });
};

const getMongoStatus = () => isMongoConnected;

const getMongoUri = () => {
  // Mask password in URI for admin display
  try {
    const url = new URL(MONGODB_URI);
    if (url.password) {
      url.password = '****';
    }
    return url.toString();
  } catch {
    return MONGODB_URI.replace(/:([^@]+)@/, ':****@');
  }
};

module.exports = { connectDB, getMongoStatus, getMongoUri };
