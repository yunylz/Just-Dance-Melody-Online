/**
 *   This is the configuration file for the API and WDF.
 */

// Internal modules
const cache = require("./lib/cache");

module.exports = {
    // API essentials
    ENV: process.env.NODE_ENV || "local",
    LOG_LEVEL: process.env.LOG_LEVEL || "info",
    PORT: process.env.PORT || 5441,

    // Database settings
    REDIS: {
        HOST: process.env.REDIS_HOST || null,
        PORT: process.env.REDIS_PORT || null,
        PASSWORD: process.env.REDIS_PASSWORD || null
    }
};