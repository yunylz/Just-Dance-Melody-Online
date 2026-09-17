import fs from "node:fs";
import path from "node:path";
import { createLogger } from "./logger";

const logger = createLogger({ service: "cache" });

/**
 * Get a file fresh from its source.
 * Will cache files in memory and update them if they change on disk.
 * JSONs are parsed automatically.
 *
 * root is the src/ folder, so the path needs to be starting from there.
 * For example: cache.file("/data/config.json")
 */
const file = <T = any>(fPath: string): T => {
    const filePath = path.join(global.root, fPath);

    if (require.cache[filePath]) {
        return require.cache[filePath]!.exports as T;
    }

    fs.watchFile(filePath, (curr, prev) => {
        if (curr.mtimeMs !== prev.mtimeMs) {
            logger.info(`File ${fPath} has changed. Deleting cached version...`);
            delete require.cache[filePath];
        }
    });

    return require(filePath) as T;
};

export { file };
