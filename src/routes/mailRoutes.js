const express = require('express');
const router = express.Router();
const { generateEmail, getMessages, deleteEmail } = require('../controllers/mailController');
const { verifyUser } = require('../middlewares/auth');

// 🛡️ ALL mail routes now require authentication
router.post('/generate', verifyUser, generateEmail);
router.get('/messages/:email', verifyUser, getMessages);
router.delete('/delete/:email', verifyUser, deleteEmail);

module.exports = router;
