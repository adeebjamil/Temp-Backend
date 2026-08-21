const express = require('express');
const router = express.Router();
const { generateEmail, getMessages, deleteEmail } = require('../controllers/mailController');
const { verifyUser } = require('../middlewares/auth');
const { checkMaintenance } = require('../middlewares/maintenance');

// 🛡️ ALL mail routes require auth + maintenance check
router.post('/generate', checkMaintenance, verifyUser, generateEmail);
router.get('/messages/:email', checkMaintenance, verifyUser, getMessages);
router.delete('/delete/:email', checkMaintenance, verifyUser, deleteEmail);

module.exports = router;
