import winston from "winston";

type LogLevel = "error" | "warn" | "info" | "success" | "http" | "cheat" | "debug";

interface CustomLevels extends winston.config.AbstractConfigSetLevels {
    error: number;
    warn: number;
    info: number;
    success: number;
    http: number;
    cheat: number;
    debug: number;
}

interface CustomLogger extends winston.Logger {
    success: winston.LeveledLogMethod;
    cheat: winston.LeveledLogMethod;
}

/**
 * Creates a logger with a service name.
 */
export const createLogger = ({ service }: { service: string }): CustomLogger => {
    if (!service) throw new Error("A service name is required in order to create a logger.");

    const levels: CustomLevels = {
        error: 0,
        warn: 1,
        info: 2,
        success: 3,
        http: 4,
        cheat: 5,
        debug: 6
    };

    const colors: Record<string, string> = {
        error: "red",
        warn: "yellow",
        info: "cyan",
        success: "green",
        http: "magenta",
        cheat: "redBG",
        debug: "white"
    };

    winston.addColors(colors);

    const level: LogLevel = process.env.LOG_LEVEL ? "debug" : "info";

    const format = winston.format.combine(
        winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
        winston.format.colorize({ all: true }),
        winston.format.printf(
            (info) => `${info.timestamp} [${info.level}] [${service}]: ${info.message}`,
        ),
    );

    const transports: winston.transport[] = [
        new winston.transports.Console(),
        new winston.transports.File({ filename: `logs/${service}.log` }),
    ];

    return winston.createLogger({
        level,
        levels,
        format,
        transports
    }) as CustomLogger;
};
