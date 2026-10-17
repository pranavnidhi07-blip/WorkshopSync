const express = require('express');
const authService = require('../services/auth.service');

const router = express.Router();

// POST /api/auth/register - Public: Register a member
router.post('/register', (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = authService.registerMember({ email, password });
    return res.status(201).json(user);
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/login - Public: Login and obtain JWT
router.post('/login', (req, res, next) => {
  try {
    const { email, password } = req.body;
    const result = authService.login({ email, password });
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
