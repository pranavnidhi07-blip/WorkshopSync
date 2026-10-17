const express = require('express');
const workshopService = require('../services/workshop.service');
const registrationService = require('../services/registration.service');
const { authenticate } = require('../middleware/authenticate');
const { authorize } = require('../middleware/authorize');

const router = express.Router();

// Protected: All routes below require valid JWT
router.use(authenticate);

// GET /api/workshops - Member/Organizer: List scheduled workshops
router.get('/', (req, res, next) => {
  try {
    const workshops = workshopService.listWorkshops('scheduled');
    return res.status(200).json(workshops);
  } catch (err) {
    next(err);
  }
});

// GET /api/workshops/:id - Member/Organizer: Get workshop details
router.get('/:id', (req, res, next) => {
  try {
    const workshop = workshopService.getWorkshopById(req.params.id);
    return res.status(200).json(workshop);
  } catch (err) {
    next(err);
  }
});

// POST /api/workshops - Organizer only: Create workshop
router.post('/', authorize('organizer'), (req, res, next) => {
  try {
    const workshop = workshopService.createWorkshop(req.body, req.user.id);
    return res.status(201).json(workshop);
  } catch (err) {
    next(err);
  }
});

// PATCH /api/workshops/:id - Organizer only: Update workshop
router.patch('/:id', authorize('organizer'), (req, res, next) => {
  try {
    const workshop = workshopService.updateWorkshop(req.params.id, req.body, req.user.id);
    return res.status(200).json(workshop);
  } catch (err) {
    next(err);
  }
});

// POST /api/workshops/:id/cancel - Organizer only: Cancel workshop and fan out notifications
router.post('/:id/cancel', authorize('organizer'), (req, res, next) => {
  try {
    const result = workshopService.cancelWorkshop(req.params.id, req.user.id);
    return res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});

// POST /api/workshops/:id/registrations - Member: Register for workshop (atomic outbox)
router.post('/:id/registrations', authorize('member'), (req, res, next) => {
  try {
    const result = registrationService.registerMember(req.params.id, req.user.id);
    return res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/workshops/:id/registrations - Organizer: List registrations for workshop
router.get('/:id/registrations', authorize('organizer'), (req, res, next) => {
  try {
    const registrations = registrationService.getWorkshopRegistrations(req.params.id, req.user.id);
    return res.status(200).json(registrations);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
