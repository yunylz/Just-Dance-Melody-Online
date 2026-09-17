// External modules
const express = require("express");

// Internal modules
const cache = require("../lib/cache");
const middlewares = require("../lib/middlewares");

const router = express.Router();

var clients;


router.post("/assign-room",
    (req, res, next) => {
        const sku = req.sku;
        const room = req.room;

        // for jd21-22, we return a correctly formatter room info
        if (["jd2021", "jd2022"].includes(sku.gameVersion)) {
            res.json({
                __class: "RoomInfo",
                room: room.roomName,
                type: "hard",
                start: null,
                end: null
            });
        } else { // for older games, return a legacy format
            res.json({
                room: room.roomName
            });
        }

        // TODO: uncomment when error handling and logging is ready
        //next();
    }
);

router.get("/online-bosses",
    (req, res, next) => {
        const { bosses } = cache.file("/data/bosses.json");

        var bossesClone = { ...bosses };

        // hide the config on each boss
        for (const bossKey in bossesClone) {
            if (bossesClone[bossKey].config) {
                delete bossesClone[bossKey].config;
            }
        }

        res.json({
            "__class": "OnlineBossDb",
            "bosses": bossesClone || {}
        });

        // TODO: uncomment when error handling and logging is ready
        //next();
    }
);

router.get("/server-time", 
    (req, res, next) => {
        res.json({
            "time": (Date.now() / 1000)
        });

        next();
    }
);


/**
 * Base routes
 */
module.exports = (clientsList) => {
    clients = clientsList;
    return router;
};