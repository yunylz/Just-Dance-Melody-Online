const setRateLimit = require("express-rate-limit");

// Rate limit middleware
const rateLimitMiddleware = setRateLimit({
  windowMs: 60 * 1000,
  max: 150,
  message: {
	status: 429,
    error: "Too many requests"
  },
  headers: false,
});

module.exports = rateLimitMiddleware;