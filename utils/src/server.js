/**
 *  This is an utility API for stuff that will be used in general by multiple dependencies.
 *  It is not meant to be used directly by end-users.
 */

const project = require("../package.json");

// Set global data
global.root = __dirname;
global.project = project;

// Load dotenv file
const dotenv = require("dotenv").config({ quiet: true });
require("dotenv-expand").expand(dotenv);

// External modules
const async = require("async");
const express = require("express");
const http = require("node:http");

// Internal modules
const config = require("./config");
//const jdmo = require("./lib/jdmo");
const logger = require("./lib/logger").createLogger({ service: global.project.name });
const mongo = require("./lib/mongodb");


const app = express();
app.use(express.json());


// Load utils server
async.waterfall(
    [
        // 1. Load config
        (callback) => {
            callback(null, config);
        },
        // 2. Load clients
        (config, callback) => {
            //jdmo.init();
            mongo.init();
            callback(null, config);
        },
        // 3. Setup routes
        (config, callback) => {
            var baseRouter = require("./routes/base");
            var verificationRouter = require("./routes/verification");

            //app.use("/", baseRouter);
            app.use("/verification", verificationRouter);

            callback(null, config);
        },
        // 4. Start server
        (config, callback) => {
            http.createServer(app).listen(config.PORT, () => {
                logger.info(`Utility server running on port ${config.PORT}`);
            });
            callback(null, config);
        }
    ], (err) => {
        if (err) {
            logger.error(`Failed to start utility server: ${err}`);
        }
    }
);