const crypto = require('node:crypto');
const workshopRepo = require('../repositories/workshop.repository');
const registrationRepo = require('../repositories/registration.repository');
const outboxRepo = require('../repositories/outbox.repository');
const { runInTransaction } = require('../db/connection');
const { AppError } = require('../middleware/errorHandler');

class WorkshopService {
  createWorkshop({ title, description, startsAt, location, capacity }, organizerId) {
    if (!title || !title.trim()) {
      throw new AppError('INVALID_INPUT', 'Title is required', 400);
    }
    if (!startsAt || isNaN(Date.parse(startsAt))) {
      throw new AppError('INVALID_INPUT', 'Valid startsAt ISO date string is required', 400);
    }
    if (!location || !location.trim()) {
      throw new AppError('INVALID_INPUT', 'Location is required', 400);
    }

    const id = 'ws_' + crypto.randomUUID();
    const now = new Date().toISOString();

    return workshopRepo.create({
      id,
      title: title.trim(),
      description: description ? description.trim() : null,
      startsAt: new Date(startsAt).toISOString(),
      location: location.trim(),
      capacity: capacity ? parseInt(capacity, 10) : null,
      status: 'scheduled',
      createdBy: organizerId,
      createdAt: now,
      updatedAt: now
    });
  }

  listWorkshops(status = 'scheduled') {
    return workshopRepo.findAll(status);
  }

  getWorkshopById(id) {
    const workshop = workshopRepo.findById(id);
    if (!workshop) {
      throw new AppError('WORKSHOP_NOT_FOUND', 'Workshop not found', 404);
    }
    return workshop;
  }

  updateWorkshop(id, fields, organizerId) {
    const workshop = this.getWorkshopById(id);
    if (workshop.status === 'cancelled') {
      throw new AppError('WORKSHOP_CANCELLED', 'Cannot update a cancelled workshop', 409);
    }

    if (fields.startsAt && isNaN(Date.parse(fields.startsAt))) {
      throw new AppError('INVALID_INPUT', 'Invalid startsAt date format', 400);
    }

    const updatePayload = {};
    if (fields.title) updatePayload.title = fields.title.trim();
    if (fields.description !== undefined) updatePayload.description = fields.description;
    if (fields.startsAt) updatePayload.starts_at = new Date(fields.startsAt).toISOString();
    if (fields.location) updatePayload.location = fields.location.trim();
    if (fields.capacity !== undefined) updatePayload.capacity = fields.capacity ? parseInt(fields.capacity, 10) : null;

    return workshopRepo.update(id, updatePayload);
  }

  cancelWorkshop(workshopId, organizerId) {
    return runInTransaction((db) => {
      const workshop = workshopRepo.findById(workshopId);
      if (!workshop) {
        throw new AppError('WORKSHOP_NOT_FOUND', 'Workshop not found', 404);
      }
      if (workshop.status === 'cancelled') {
        throw new AppError('ALREADY_CANCELLED', 'Workshop is already cancelled', 409);
      }

      // Update workshop status to cancelled
      workshopRepo.updateStatus(workshopId, 'cancelled');

      // Fetch all registered members
      const registrations = registrationRepo.findByWorkshopId(workshopId, db);
      const now = new Date().toISOString();

      // Enqueue one cancellation notification job per registered member
      for (const reg of registrations) {
        const jobId = 'job_' + crypto.randomUUID();
        const eventKey = `cancel_${workshopId}_${reg.member_id}`;
        const payloadJson = JSON.stringify({
          workshopId,
          memberId: reg.member_id,
          workshopTitle: workshop.title,
          notice: 'Workshop has been cancelled by organizer'
        });

        outboxRepo.createJob({
          id: jobId,
          eventKey,
          eventType: 'workshop_cancellation',
          recipientUserId: reg.member_id,
          payloadJson,
          status: 'pending',
          attempts: 0,
          createdAt: now,
          updatedAt: now
        }, db);
      }

      return {
        workshopId,
        status: 'cancelled',
        affectedMembers: registrations.length
      };
    });
  }
}

module.exports = new WorkshopService();
