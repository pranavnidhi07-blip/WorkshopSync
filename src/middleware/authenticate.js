const jwt = require('jsonwebtoken');
const config = require('../config/env');
const { AppError } = require('./errorHandler');

function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return next(new AppError('UNAUTHORIZED', 'Missing Authorization header', 401));
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
    return next(new AppError('UNAUTHORIZED', 'Malformed Authorization header. Format: Bearer <token>', 401));
  }

  const token = parts[1];
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return next(new AppError('UNAUTHORIZED', 'Invalid or expired token', 401));
  }
}

module.exports = { authenticate };
