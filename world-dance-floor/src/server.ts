/**
 * WDF server for Just Dance Melody Online
 */

// Set global variables
global.root = __dirname;
global.project = require("../package.json");

// Load .env
import dotenvFlow from "dotenv";
const dotenvResult = dotenvFlow.config({ debug: false });
import dotenvExpand from "dotenv-expand";
dotenvExpand.expand(dotenvResult);

import asyncLib from "async";
import express from "express";
import * as http from "node:http";

import { init as libsInit } from "./lib/libs";
import { createLogger } from "./lib/logger";
import { init as middlewaresInit } from "./lib/middlewares";
import * as redisModule from "./lib/redis";
import { init as scoreProtectorInit } from "./lib/score-protector";

import * as config from "./config";

import baseRouter from "./routes/base";
import managementRouter from "./routes/management";
import roomsRouter from "./routes/rooms";

import * as wdfRoomManager from "./wdf/room-manager";

const app = express();
const logger = createLogger({ service: (global as any).project.name });

asyncLib.waterfall([
    // 1. Setup middlewares
    (callback: Function) => {
        middlewaresInit(app);
        callback(null, config);
    },
    // 2. Load clients
    (cfg: typeof config, callback: Function) => {
        const clients = libsInit({
            wdfLeaderboard:   "./wdf/leaderboard",
            wdfNotifications: "./wdf/notifications",
            wdfRoomManager:   "./wdf/room-manager",
            wdfSchedule:      "./wdf/schedule",
            wdfScoring:       "./wdf/scoring",
            wdfScreens:       "./wdf/screens",
            wdfSessions:      "./wdf/sessions",
            wdfThemes:        "./wdf/themes",
            wdfSongSelector:  "./wdf/song-selector",
            wdfStats:         "./wdf/stats",
        });

        redisModule.init();
        scoreProtectorInit();
        callback(null, cfg, clients);
    },
    // 3. Setup routes
    (cfg: typeof config, clients: any, callback: Function) => {
        app.use("/wdf/v1", baseRouter(clients));
        app.use("/wdf/v1/management", managementRouter(clients));
        app.use("/wdf/v1/rooms", roomsRouter(clients));
        callback(null, cfg);
    },
    // 4. Start server
    (cfg: typeof config, callback: Function) => {
        http.createServer(app).listen(cfg.PORT, () => {
            logger.info("JDMO WDF Server is running on port " + cfg.PORT);
        });
        callback(null, cfg);
    },
    // 5. Start rooms
    (cfg: typeof config, callback: Function) => {
        wdfRoomManager.start({ room: "MainJDMO",  gameVersion: "jd2018", intervalMs: 1000 });
        wdfRoomManager.start({ room: "2017JDMO",  gameVersion: "jd2017", intervalMs: 1000 });
        callback(null, cfg);
    },
], (err: any) => {
    if (err) {
        logger.error("Failed to start JDMO WDF Server:", err);
        process.exit(1);
    }
});
