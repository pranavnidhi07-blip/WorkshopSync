const express = require('express');
const registrationService = require('../services/registration.service');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

const router = express.Router();

router.use(authenticate);

// GET /api/me/registrations - Member: List own registrations
router.get('/registrations', authorize('member'), (req, res, next) => {
  try {
    const list = registrationService.getMemberRegistrations(req.user.id);
    return res.status(200).json(list);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
