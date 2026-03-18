// routes/logRoutes.js
const express = require('express');
const router = express.Router();
const { getLogs } = require('../controllers/logController');
const { protect } = require('../middleware/authMiddleware');
const { protectAdmin } = require('../middleware/adminMiddleware');

// GET /api/logs — เฉพาะ Admin (executive, manager, hr)
router.get('/', protect, protectAdmin, getLogs);

module.exports = router;
