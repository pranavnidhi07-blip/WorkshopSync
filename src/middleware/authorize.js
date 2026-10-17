const { AppError } = require('./errorHandler');

function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return next(new AppError('UNAUTHORIZED', 'Authentication required', 401));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError('FORBIDDEN', `Forbidden: required role [${allowedRoles.join(', ')}]`, 403));
    }

    next();
  };
}

module.exports = { authorize };
