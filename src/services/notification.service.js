const outboxRepo = require('../repositories/outbox.repository');
const { AppError } = require('../middleware/errorHandler');

class NotificationService {
  getJobById(id, requestingUser) {
    const job = outboxRepo.findById(id);
    if (!job) {
      throw new AppError('NOTIFICATION_NOT_FOUND', 'Notification job not found', 404);
    }

    // Role-based access rule: Organizers can inspect all jobs; members only their own
    if (requestingUser.role !== 'organizer' && job.recipient_user_id !== requestingUser.id) {
      throw new AppError('FORBIDDEN', 'You do not have permission to inspect this notification', 403);
    }

    return {
      id: job.id,
      eventKey: job.event_key,
      eventType: job.event_type,
      recipientUserId: job.recipient_user_id,
      payload: JSON.parse(job.payload_json),
      status: job.status,
      attempts: job.attempts,
      nextAttemptAt: job.next_attempt_at,
      lockedUntil: job.locked_until,
      lastError: job.last_error,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      deliveredAt: job.delivered_at
    };
  }
}

module.exports = new NotificationService();
