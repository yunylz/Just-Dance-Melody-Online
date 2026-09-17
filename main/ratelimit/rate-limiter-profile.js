const setRateLimit = require("express-rate-limit");

// Rate limit middleware
const rateLimitMiddlewareSessions = setRateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: {
	status: 429,
    error: "Too many requests"
  },
  headers: false,
});

module.exports = rateLimitMiddlewareSessions;