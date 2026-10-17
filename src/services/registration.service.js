const crypto = require('node:crypto');
const workshopRepo = require('../repositories/workshop.repository');
const registrationRepo = require('../repositories/registration.repository');
const outboxRepo = require('../repositories/outbox.repository');
const { runInTransaction } = require('../db/connection');
const { AppError } = require('../middleware/errorHandler');

class RegistrationService {
  registerMember(workshopId, memberId) {
    return runInTransaction((db) => {
      // 1. Validate workshop
      const workshop = workshopRepo.findById(workshopId);
      if (!workshop) {
        throw new AppError('WORKSHOP_NOT_FOUND', 'Workshop not found', 404);
      }
      if (workshop.status === 'cancelled') {
        throw new AppError('WORKSHOP_CANCELLED', 'Cannot register for a cancelled workshop', 409);
      }

      // Check capacity if set
      if (workshop.capacity !== null && workshop.capacity !== undefined) {
        const currentCount = registrationRepo.countByWorkshopId(workshopId, db);
        if (currentCount >= workshop.capacity) {
          throw new AppError('WORKSHOP_FULL', 'Workshop is at maximum capacity', 409);
        }
      }

      // Check duplicate registration
      const existing = registrationRepo.findOne(workshopId, memberId, db);
      if (existing) {
        throw new AppError('DUPLICATE_REGISTRATION', 'Already registered for this workshop', 409);
      }

      const registrationId = 'reg_' + crypto.randomUUID();
      const jobId = 'job_' + crypto.randomUUID();
      const now = new Date().toISOString();

      // 2. Insert registration
      try {
        registrationRepo.create({
          id: registrationId,
          workshopId,
          memberId,
          createdAt: now
        }, db);
      } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
          throw new AppError('DUPLICATE_REGISTRATION', 'Already registered for this workshop', 409);
        }
        throw err;
      }

      // 3. Insert outbox confirmation job in the SAME transaction
      const eventKey = `reg_confirm_${workshopId}_${memberId}`;
      const payloadJson = JSON.stringify({
        workshopId,
        memberId,
        workshopTitle: workshop.title,
        startsAt: workshop.starts_at,
        location: workshop.location
      });

      outboxRepo.createJob({
        id: jobId,
        eventKey,
        eventType: 'registration_confirmation',
        recipientUserId: memberId,
        payloadJson,
        status: 'pending',
        attempts: 0,
        createdAt: now,
        updatedAt: now
      }, db);

      // 4. Return fast response matching SDD contract exactly
      return {
        registrationId,
        workshopId,
        status: 'registered',
        notification: {
          status: 'pending',
          jobId
        }
      };
    });
  }

  getMemberRegistrations(memberId) {
    return registrationRepo.findByMemberId(memberId);
  }

  getWorkshopRegistrations(workshopId, organizerId) {
    const workshop = workshopRepo.findById(workshopId);
    if (!workshop) {
      throw new AppError('WORKSHOP_NOT_FOUND', 'Workshop not found', 404);
    }
    return registrationRepo.findByWorkshopId(workshopId);
  }
}

module.exports = new RegistrationService();
