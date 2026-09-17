// External modules
const fs = require("node:fs");
const path = require("node:path");

// Internal modules
const logger = require("./logger").createLogger({ service: "cache" });


/**
 * Get a file fresh from its source.
 * Will cache files in memory and update them if they change on disk.
 * JSONs are parsed automatically.
 * 
 * root is the src/ folder, so the path needs to be starting from there
 * for example if I wanna load src/data/... then I need to call file("/data/...")
 * @param {String} path 
 * @returns {Object|Array}
 */
const file = (fPath) => {
    const filePath = path.join(global.root, fPath);

    // Check if the file is already cached
    if (require.cache[filePath]) {
        return require.cache[filePath].exports;
    }

    // Start watching the file for changes
    fs.watchFile(filePath, (curr, prev) => {
        if (curr.mtimeMs !== prev.mtimeMs) {
            logger.info(`File ${fPath} has changed. Deleting cached version...`);
            delete require.cache[filePath];
        }
    });
        
    return require(filePath);
};


module.exports = {
    file
};