const express = require('express');
const router = express.Router();
const { googleLogin, deleteAccount } = require('../controllers/authController');
const { verifyUser } = require('../middlewares/auth');

router.post('/google-login', googleLogin);
router.delete('/delete', verifyUser, deleteAccount);

module.exports = router;
