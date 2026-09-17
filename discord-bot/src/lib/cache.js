// Internal modules
const logger = require("./logger").createLogger({ service: "cache" });

/**
 * Start a simple in-memory cache
 */
const init = () => {
    global.cache = {};
    global.cacheTTL = {};

    logger.info("Cache initialized.");
};

/**
 * Set a value to be cached, ttl is optional
 * @param {String} key 
 * @param {*} value 
 * @param {Integer} ttl in seconds
 */
const set = (key, value, ttl = null) => {
    if (global.cache[key]) {
        logger.info(`Overwriting existing cache value for "${key}".`);
    }

    global.cache[key] = value;

    if (ttl) {
        const expiresAt = Date.now() + (ttl * 1000);
        global.cacheTTL[key] = expiresAt;
    }
    
    logger.info(`Set value for "${key}" in cache${ttl ? ` with TTL of ${ttl} seconds` : ""}.`);
}

/**
 * Get a cached value
 * @param {String} key 
 * @returns {*}
 */
const get = (key) => {
    if (global.cacheTTL[key] && global.cacheTTL[key] < (Date.now() * 1000)) {
        delete global.cache[key];
        delete global.cacheTTL[key];
        return null;
    }

    return global.cache[key];
}

/**
 * Delete a cached value
 * @param {String} key 
 */
const deleteValue = (key) => {
    delete global.cache[key];
    delete global.cacheTTL[key];

    logger.info(`Deleted value for "${key}" from cache.`);
}

/**
 * Clear the entire cache
 */
const clear = () => {
    global.cache = {};
    global.cacheTTL = {};

    logger.info("Cleared entire cache.");
}

module.exports = {
    init,
    set,
    get,
    delete: deleteValue,
    clear
};