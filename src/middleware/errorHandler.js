class AppError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

function errorHandler(err, req, res, next) {
  // If headers are already sent, delegate to default Express handler
  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err.statusCode || (err.status >= 400 && err.status < 600 ? err.status : 500);
  const code = err.code || (statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'INVALID_REQUEST');
  const message = statusCode === 500 ? 'An unexpected internal error occurred' : err.message;

  // Log server errors for observability without leaking secrets
  if (statusCode >= 500) {
    console.error(`[ERROR] ${new Date().toISOString()} ${req.method} ${req.url} - ${err.message}`);
  }

  return res.status(statusCode).json({
    error: {
      code,
      message
    }
  });
}

module.exports = {
  AppError,
  errorHandler
};
