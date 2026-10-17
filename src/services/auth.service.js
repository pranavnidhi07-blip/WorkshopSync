const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config/env');
const userRepo = require('../repositories/user.repository');
const { AppError } = require('../middleware/errorHandler');

class AuthService {
  registerMember({ email, password }) {
    if (!email || !email.includes('@')) {
      throw new AppError('INVALID_INPUT', 'A valid email address is required', 400);
    }
    if (!password || password.length < 6) {
      throw new AppError('INVALID_INPUT', 'Password must be at least 6 characters long', 400);
    }

    const existing = userRepo.findByEmail(email.toLowerCase().trim());
    if (existing) {
      throw new AppError('EMAIL_EXISTS', 'An account with this email already exists', 409);
    }

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password, salt);
    const id = 'usr_' + crypto.randomUUID();
    const createdAt = new Date().toISOString();

    // Security policy: Public registration is always for 'member' role
    const user = userRepo.create({
      id,
      email: email.toLowerCase().trim(),
      passwordHash,
      role: 'member',
      createdAt
    });

    return {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt
    };
  }

  login({ email, password }) {
    if (!email || !password) {
      throw new AppError('INVALID_CREDENTIALS', 'Email and password are required', 400);
    }

    const user = userRepo.findByEmail(email.toLowerCase().trim());
    if (!user) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
    }

    const isMatch = bcrypt.compareSync(password, user.password_hash);
    if (!isMatch) {
      throw new AppError('INVALID_CREDENTIALS', 'Invalid email or password', 401);
    }

    const payload = {
      id: user.id,
      email: user.email,
      role: user.role
    };

    const token = jwt.sign(payload, config.JWT_SECRET, {
      expiresIn: config.JWT_EXPIRES_IN
    });

    return {
      token,
      user: payload
    };
  }
}

module.exports = new AuthService();
