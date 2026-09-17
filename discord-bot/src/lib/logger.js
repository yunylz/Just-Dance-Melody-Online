// External modules
const winston = require("winston");

/**
 * Creates a logger with given service name
 * @param {String} service 
 * @returns {winston.Logger}
 */
module.exports.createLogger = ({ service }) => {
    if (!service) throw new Error(`A service name is required in order to create a logger.`);

    const levels = {
        error: 0,
        warn: 1,
        info: 2,
        success: 3,
        http: 4,
        cheat: 5,
        debug: 6
    };
    
    const colors = {
        error: "red",
        warn: "yellow",
        info: "cyan",
        success: "green",
        http: "magenta",
        cheat: "redBG",
        debug: "white"
    };

    winston.addColors(colors);

    const level = global.config?.LOG_LEVEL || process.env.LOG_LEVEL || "info";

    const format = winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }), // Date format
        winston.format.colorize({ all: true }), // All logs must have color
        // Define the format of the message with time, level and message
        winston.format.printf(
            (info) => `${info.timestamp} [${info.level}] [${service}]: ${info.message}`,
        ),
    );

    const transports = [
        // Allow the use the console to print the messages
        new winston.transports.Console(),
        // Allow to write logs to file
        // new LokiTransport({
        //     host: "http://127.0.0.1:3100",
        //     labels: {
        //       job: global.config.METRICS.job,
        //       env: global.ENV
        //     }
        // })
    ];

    const logger = winston.createLogger({
        level,
        levels,
        format,
        transports
    });

    return logger;
};