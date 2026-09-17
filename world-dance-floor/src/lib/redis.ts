import * as redisLib from "redis";
import * as config from "../config";
import { createLogger } from "./logger";

const logger = createLogger({ service: "redis" });

export const client = redisLib.createClient({
    socket: {
        host: config.REDIS.HOST ?? undefined,
        port: config.REDIS.PORT ? Number(config.REDIS.PORT) : undefined
    },
    password: config.REDIS.PASSWORD ?? undefined
});

export const init = async (): Promise<void> => {
    if (!config.REDIS.HOST || !config.REDIS.PORT) {
        throw new Error("Redis is not fully setup in the config. Caching will not work.");
    }

    client.on("error", (err: Error) => logger.error("Client error:", err));

    await client.connect()
        .then(() => { logger.success("Connected to Redis!"); })
        .catch((err: Error) => { logger.error("Failed to connect to Redis:", err); });
};
