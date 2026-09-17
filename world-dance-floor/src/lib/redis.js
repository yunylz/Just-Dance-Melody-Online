// External modules
const redis = require("redis");

// Internal modules
const config = require("../config");
const logger = require("./logger").createLogger({ service: "redis" });

/**
 * Redis client
 * @returns {redis.RedisClientType}
 */
const client = redis.createClient({
    socket: {
        host: config.REDIS.HOST,
        port: config.REDIS.PORT
    },
    password: config.REDIS.PASSWORD || undefined
});

/**
 * Initialize redis client
 */
const init = async () => {
    if (!config.REDIS.HOST || !config.REDIS.PORT) {
        throw new Error("Redis is not fully setup in the config. Caching will not work.");
    }
    
    client.on("error", (err) => logger.error("Client error:", err));
    
    await client.connect().then(() => {
        logger.success("Connected to Redis!");
    }).catch((err) => {
        logger.error("Failed to connect to Redis:", err);
    });
};


module.exports = {
    init,
    client
};