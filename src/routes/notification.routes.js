const express = require('express');
const notificationService = require('../services/notification.service');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

router.use(authenticate);

// GET /api/notifications/:id - Organizer or authorized member
router.get('/:id', (req, res, next) => {
  try {
    const job = notificationService.getJobById(req.params.id, req.user);
    return res.status(200).json(job);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
