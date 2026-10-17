const express = require('express');
const authRoutes = require('./routes/auth.routes');
const workshopRoutes = require('./routes/workshop.routes');
const registrationRoutes = require('./routes/registration.routes');
const notificationRoutes = require('./routes/notification.routes');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

// Standard middleware
app.use(express.json());

// Public health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Mount modular API routers
app.use('/api/auth', authRoutes);
app.use('/api/workshops', workshopRoutes);
app.use('/api/me', registrationRoutes);
app.use('/api/notifications', notificationRoutes);

// Catch-all 404 handler for unknown routes
app.use((req, res, next) => {
  res.status(404).json({
    error: {
      code: 'ROUTE_NOT_FOUND',
      message: `Cannot ${req.method} ${req.originalUrl}`
    }
  });
});

// Centralized error handler
app.use(errorHandler);

module.exports = app;
