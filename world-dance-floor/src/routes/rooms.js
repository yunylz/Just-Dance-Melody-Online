// External modules
const express = require("express");

// Internal modules
const cache = require("../lib/cache");
const logger = require("../lib/logger").createLogger({ service: "routes/rooms" });
const middlewares = require("../lib/middlewares");
const oasis = require("../lib/oasis");
const redis = require("../lib/redis").client;
const scoreProtector = require("../lib/score-protector");

// WDF modules
var wdfLeaderboard;
var wdfNotifications;
var wdfRoomManager;
var wdfSessions;

const router = express.Router();


// MIDDLEWARES
const checkRoomExistsAndIsCorrectMiddleware = (req, res, next) => {
    const { rooms } = cache.file("/data/rooms.json");

    // find room by sku gameVersion
    const correctRoom = rooms.find(r => r.skus.includes(req.sku.id));

    if (req.params.room !== correctRoom.roomName) {
        return res.status(400).send({
            "error": "room does not exist or is not correct for this SKU"
        });
    }

    next();
};

const scoreValidityMiddleware = (req, res, next) => {
    if (!req.body.score) {
        logger.warn(`No score submitted in room '${req.params.room}' by pid '${req.tokenData.ProfileId}'`);
        return next();
    }

    if (req.body.score < 0 || req.body.score > 1) {
        logger.warn(`Invalid score submitted in room '${req.params.room}' by pid '${req.tokenData.ProfileId}': ${req.body.score}`);
        return res.status(400).send({
            "error": "invalid score submitted, you've been logged :3"
        });
    } else if (req.body.score == 1) {
        logger.warn(`Perfect score (1) submitted in room '${req.params.room}' by pid '${req.tokenData.ProfileId}'`);
    }

    next();
};


router.post("/:room/screens",
    async (req, res, next) => {
        var screens = await redis.zRangeByScore(`wdf:rooms:${req.params.room}:screens`, req.body.startTime, "+inf");

        if (!screens || screens.length === 0) {
            screens = [];
        }

        res.setHeader("Content-Type", "application/json")
        res.send("{ \"__class\":\"ScreenList\", \"screens\": [" + screens.join(",")  + "] }");

        next();
    }
);

router.get("/:room/ccu",
    async (req, res, next) => {
        await wdfSessions.getNumberOfPlayers({
            room: req.params.room
        }).then((ccu) => {
            res.send("" + ccu);
            next();
        }).catch((err) => {
            res.sendStatus(500);
            next();
        });
    }
);

router.get("/:room/next-happyhours",
    async (req, res, next) => {
        res.json({
            "__class": "HappyHoursInfo",
            "start": (Date.now() / 1000) - 60000, // started 1 minute ago
            "end": (Date.now() / 1000) + 18327600, // always 212 :D
            "running": true
        });
        next();
    }
);

router.post("/:room/session",
    async (req, res, next) => {
        const pid = req.tokenData.ProfileId;

        await wdfSessions.joinSession({
            room: req.params.room,
            pid: pid,
            platform: req.sku.platform,
            profile: req.profile
        }).then(() => {
            res.sendStatus(200);
            next();
        }).catch((err) => {
            res.sendStatus(500);
            next();
        });
    }
);

router.delete("/:room/session",
    async (req, res, next) => {
        const pid = req.tokenData.ProfileId;

        await wdfSessions.leaveSession({
            room: req.params.room,
            pid: pid
        }).then(() => {
            res.sendStatus(200);
            next();
        }).catch((err) => {
            res.sendStatus(500);
            next();
        });
    }
);

router.get("/:room/session-recap",
    async (req, res, next) => {
        const pid = req.tokenData.ProfileId;

        await wdfSessions.getSessionInfo({
            room: req.params.room,
            pid: pid
        }).then((sessionInfo) => {
            sessionInfo.__class = "SessionRecapInfo";
            res.json(sessionInfo);
            next();
        }).catch((err) => {
            res.sendStatus(500);
            next();
        });
    }
);

router.get("/:room/newsfeed",
    async (req, res, next) => {
        var welcomeToJDMOEntry = {
            "__class": "NewsfeedEntry",
            "pictureUrl": "https://jdmo-cdn.c0llydoll.com/public/wdf/newsfeed/seasonalLogos/dfb2287af095f1440fdbc3a4fc05b019.png",
            "text": "You are currently playing\nJust Dance Melody Online :D",
            "title": "Welcome back !"
        };

        res.json({
            "__class": "NewsfeedList",
            "entries": [welcomeToJDMOEntry]
        });
        next();
    }
);

router.get("/:room/online-rank-widget",
    async (req, res, next) => {
        try {
            var currentSeasonDetails = await wdfLeaderboard.getCurrentSeasonDetails({
                room: req.params.room
            });

            var currentSeasonEndTime = (currentSeasonDetails && currentSeasonDetails.endTime) ? (currentSeasonDetails.endTime / 1000) : null;

            var seasonNumber = currentSeasonDetails ? currentSeasonDetails.seasonNumber : null;

            var currentUserOnlineRankInfo = await wdfLeaderboard.getLb({
                room: req.params.room,
                pid: req.tokenData.ProfileId,
            });

            if (currentUserOnlineRankInfo[0]) {
                currentUserOnlineRankInfo[0].__class = "WDFOnlineRankInfo";
                currentUserOnlineRankInfo[0].dc.__class = "ScoreEntry";
            }

            var currentUserPreviousSeasonOnlineRankInfo = await wdfLeaderboard.getLbPreviousSeason({
                room: req.params.room,
                pid: req.tokenData.ProfileId,
            });

            if (currentUserPreviousSeasonOnlineRankInfo[0]) {
                currentUserPreviousSeasonOnlineRankInfo[0].__class = "WDFOnlineRankInfo";
                currentUserPreviousSeasonOnlineRankInfo[0].dc.__class = "ScoreEntry";
            }

            var currentSeasonDancerCount = await wdfLeaderboard.getCurrentSeasonLbLen({
                room: req.params.room
            });

            var previousSeasonWinner = await wdfLeaderboard.getLbPreviousSeason({
                room: req.params.room,
                rank: 1
            });

            if (previousSeasonWinner[0]) {
                previousSeasonWinner[0].__class = "WDFOnlineRankInfo";
                previousSeasonWinner[0].dc.__class = "ScoreEntry";
            }

            var finalResponse = {
                "__class": "OnlineRankWidgetInfo",
                "currentSeasonEndTime": currentSeasonEndTime,
                "seasonNumber": seasonNumber,
                "currentSeasonDancerCount": currentSeasonDancerCount,
                "previousSeasonWinner": previousSeasonWinner[0],
                "currentUserOnlineRankInfo": currentUserOnlineRankInfo[0],
                "currentUserPreviousSeasonOnlineRankInfo": currentUserPreviousSeasonOnlineRankInfo[0]
            }

            return res.json(finalResponse);
        } catch (err) {
            res.sendStatus(500);
            next();
            return;
        }
    }
);

router.get("/:room/notification",
    async (req, res, next) => {
        try {
            var notification = await wdfNotifications.getNotification({
                room: req.params.room,
                language: req.language
            });

            res.json(notification);
            next();
            return;
        } catch (err) {
            res.sendStatus(500);
            next();
            return;
        }
    }
);

router.post("/:room/themes/:type/update-scores",
    scoreValidityMiddleware,
    async (req, res, next) => {
        try {
            var result = await wdfRoomManager.forwardUpdateScores({
                room: req.params.room,
                type: req.params.type,
                pid: req.tokenData.ProfileId,
                score: req.body
            });

            res.json(result);
            next();
        } catch (err) {
            console.error(`Error in updating scores for room '${req.params.room}', type '${req.params.type}': ${err.stack}`);  
            res.sendStatus(500);
            next();
        }
    }
);

router.get("/:room/themes/:type/score-recap",
    async (req, res, next) => {
        try {
            var recap = await wdfRoomManager.forwardGetScoreRecap({
                room: req.params.room,
                type: req.params.type,
                pid: req.tokenData.ProfileId,
                score: req.body
            });

            res.json(recap);
            next();
        } catch (err) {
            console.error(`Error in getting score recap for room '${req.params.room}', type '${req.params.type}': ${err.stack}`);  
            res.sendStatus(500);
            next();
        }
    }
);

router.post("/:room/themes/vote/choice",
    async (req, res, next) => {
        try {
            await redis.incr("wdf:rooms:" + req.params.room + ":vote-option:" + req.body.voteOption);
            res.sendStatus(200);
        } catch (err) {
            console.error(`Error in submitting vote choice for room '${req.params.room}': ${err.stack}`);  
            res.sendStatus(500);
            next();
            return;
        }
    }
);

router.get("/:room/themes/vote/result",
    async (req, res, next) => {
        async function getVoteResult(room) {
            var value = await redis.get(`wdf:rooms:${room}:vote-result`);

            try {
                value = JSON.parse(value);
            } catch (err) {
                // Ignore parse errors, treat as no result
                value = null;
            }
            
            return value;
        }

        try {
            var value = await getVoteResult(req.params.room);

            // to avoid crashes, we're gonna be looping the function until we get the vote results
            // ghetto? maybe but it works.
            if (!value) {
                logger.warn(`[${req.params.room}] Vote result for room was not ready yet, waiting...`);
                const pollForResult = async () => {
                    value = await getVoteResult(req.params.room);
                    if (value) {
                        value.forEach((entry) => {
                            entry.__class = "VoteResultEntry";
                        });

                        res.json({
                            "__class": "VoteResult",
                            entries: value
                        });

                        return next();
                    } else {
                        setTimeout(pollForResult, 100);
                    }
                };
                setTimeout(pollForResult, 100);
            } else {
                value.forEach((entry) => {
                    entry.__class = "VoteResultEntry";
                });

                res.json({
                    "__class": "VoteResult",
                    entries: value
                });

                return next();
            }
        } catch (err) {
            console.error(`Error in getting vote result for room '${req.params.room}': ${err.stack}`);  
            res.sendStatus(500);
            next();
            return;
        }
    }
);

router.post("/:room/themes/teambattle/team-names",
    async (req, res, next) => {
        if (req.body.teamLocIds.length !== 2) return res.statusCode(400);

        var teamNames = req.body.teamLocIds.map(function(locId) {
            return oasis.getLocalization(locId, req.language);
        })

        res.json({
            __class: "TeamBattleTeamNames",
            localisedTeamNames: teamNames
        })

        return next();
    }
);

router.get("/:room/themes/:type/score-status",
    async (req, res, next) => {
        var result = await wdfRoomManager.forwardGetScoreStatus({
            room: req.params.room,
            type: req.params.type,
            pid: req.tokenData.ProfileId
        });

        var sendScoreSignature = true

		if ((req.sku.gameVersion === "jd2017" && req.sku.platform !== "pc") || req.sku.gameVersion === "jd2018")
			sendScoreSignature = false;

		if (sendScoreSignature)
			result.scoreSignature = scoreProtector.sign(result.score, "float", req.sku.platform)

        res.json(result);
        
        next();
    }
);


/**
 * Base routes
 */
module.exports = (clients) => {
    wdfLeaderboard = clients.wdfLeaderboard;
    wdfNotifications = clients.wdfNotifications;
    wdfRoomManager = clients.wdfRoomManager;
    wdfSessions = clients.wdfSessions;

    return router;
};