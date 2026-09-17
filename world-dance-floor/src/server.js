/**
 *   WDF server for Just Dance Melody Online
 * 
 * - This server will handle all of the WDF service's routes
 *   and all the WDF logic and communication.
 * - This server does NOT handle any JMCS routes or logic, like
 *   authorization verification, sku checks, etc. 
 *   All of the rest should be handled by the JMCS server.
*/

// Set global variables
global.root = __dirname;
global.project = require("../package.json");

// Load .env
const dotenv = require("dotenv").config({ quiet: true });
require("dotenv-expand").expand(dotenv);

// External modules
const async = require("async");
const express = require("express");
const http = require("node:http");

// Internal modules
const libs = require("./lib/libs");
const logger = require("./lib/logger").createLogger({ service: global.project.name });
const middlewares = require("./lib/middlewares");
const redis = require("./lib/redis");
const scoreProtector = require("./lib/score-protector");

// Start express client
const app = express();

async.waterfall([
    // 1. Load config
    (callback) => {
        const config = require("./config");
        callback(null, config);
    },
    // 2. Setup middlewares
    (config, callback) => {
        middlewares.init(app);
        callback(null, config);
    },
    // 3. Load clients
    (config, callback) => {
        // Load WDF modules
        var clients = libs.init({
            //wdfBotsManager: "./wdf/bots-manager",
            wdfLeaderboard: "./wdf/leaderboard",
            //wdfNewsFeed: "./wdf/newsfeed",
            wdfNotifications: "./wdf/notifications",
            wdfRoomManager: "./wdf/room-manager",
            wdfSchedule: "./wdf/schedule",
            wdfScoring: "./wdf/scoring",
            wdfScreens: "./wdf/screens",
            wdfSessions: "./wdf/sessions",
            wdfThemes: "./wdf/themes",
            wdfSongSelector: "./wdf/song-selector",
            wdfStats: "./wdf/stats",
        });

        redis.init();
        scoreProtector.init();
        callback(null, config, clients);
    },
    // 4. Setup routes
    (config, clients, callback) => {

        var baseRouter = require("./routes/base")(clients);
        var managementRouter = require("./routes/management")(clients);
        var roomsRouter = require("./routes/rooms")(clients);

        app.use("/wdf/v1", baseRouter);
        app.use("/wdf/v1/management", managementRouter);
        app.use("/wdf/v1/rooms", roomsRouter);
        
        callback(null, config);
    },
    // 5. Start server
    (config, callback) => {
        http.createServer(app).listen(config.PORT, () => {
            logger.info("JDMO WDF Server is running on port " + config.PORT);
        });
        callback(null, config);
    },
    // TODO: initialize rooms properly
    (config, callback) => {
        const wdfRoomManager = require("./wdf/room-manager");
        wdfRoomManager.start({
            room: "MainJDMO",
            gameVersion: "jd2018",
            intervalMs: 1000
        });
        wdfRoomManager.start({
            room: "2017JDMO",
            gameVersion: "jd2017",
            intervalMs: 1000
        });
        callback(null, config);
    },
    // TODO: error handler and logging
], (err) => {
    if (err) {
        logger.error("Failed to start JDMO WDF Server:", err);
        process.exit(1);
    }
});

