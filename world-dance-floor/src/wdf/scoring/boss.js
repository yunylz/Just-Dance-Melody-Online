// External modules

// Internal modules
const cache = require("../../lib/cache");
const logger = require("../../lib/logger").createLogger({ service: "wdf/themes/boss" });
const redis = require("../../lib/redis").client;

// WDF modules
const wdfConfig = cache.file("/data/config.json").config;
var wdfSessions;
var wdfStats;
var wdfLeaderboard;

var keys = {
	playerScores: 		function(room) 	{ return "wdf:rooms:" + room + ":player-scores" },
	recap: 				function(room) 	{ return "wdf:rooms:" + room + ":score-recap" },
	lastStar: 			function(room) 	{ return "wdf:rooms:" + room + ":boss:last-star" },
	finalBlow: 			function(room) 	{ return "wdf:rooms:" + room + ":boss:final-blow" },
	bossStatus: 		function(room) 	{ return "wdf:rooms:" + room + ":boss:boss-status" },
	playerEnergies: 	function(room) 	{ return "wdf:rooms:" + room + ":player-energies" },
	recentStarPlayer: 	function(room) 	{ return "wdf:rooms:" + room + ":recent-star-player" },
	recapComputed: 		function(room)	{ return "wdf:rooms:" + room + ":recap-computed" }
};


const calculateStars = (score, roomGameVersion) => {
	var sixthStarValue = 5.5;
	var seventhStarValue = 6;

	var stars = 0;
	var playerStars = (score * 13333)/2000;

	if (roomGameVersion === "jd2017") {
		if (playerStars > sixthStarValue) {
			stars = 6;
		} else {
			stars = playerStars;
		}
	} else {
		if (playerStars > sixthStarValue && playerStars < seventhStarValue) {
			stars = 6;
		} else if(playerStars > seventhStarValue) {
			stars = 7;
		} else {
			stars = playerStars;
		}
	}
	return Math.floor(stars);
};

const init = (clients) => {
    wdfSessions = clients.wdfSessions;
    wdfStats = clients.wdfStats;
    wdfLeaderboard = clients.wdfLeaderboard;
    return;
};

const clearPlayerScoreData = async (options) => {
    try {
        var multi = redis.multi();

        // clear player scores
        multi.zUnionStore(keys.playerScores(options.room), [keys.playerScores(options.room)], { weights: [0] });
        multi.zUnionStore(keys.playerEnergies(options.room), [keys.playerEnergies(options.room)], { weights: [0] });

        multi.del(keys.lastStar(options.room));
        multi.del(keys.finalBlow(options.room));
        multi.del(keys.recentStarPlayer(options.room));

        await multi.exec();
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::boss::clearPlayerScoreData()\nFailed to clear player score data: ${err.message}`);
        throw err;
    }
    return;
};

const cleanUp = async (options) => {
    try {
        var multi = redis.multi();

        Object.keys(keys).forEach((key) => {
            multi.del(keys[key](options.room));
        });

        await multi.exec();
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::boss::cleanUp()\nFailed to clean up boss scoring data: ${err.message}`);
        throw err;
    }
    return;
};

const start = async (options) => {
    try {
        await cleanUp(options);

        await redis.set(keys.bossStatus(options.room), JSON.stringify({
		    bossHealth: options.state.bossState.bossMaxHealth,
			bossMaxHealth: options.state.bossState.bossMaxHealth,
			previousRoundStars: 0
		}));
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::boss::start()\nFailed to start boss scoring: ${err.message}`);
        throw err;
    }
};

const computeRecap = async (options) => {
    try {
        var multi = redis.multi();

        multi.get(keys.bossStatus(options.room));
        multi.zRangeWithScores(keys.playerScores(options.room), 0, 0, { REV: true });
        multi.zRangeWithScores(keys.playerEnergies(options.room), 0, 0, { REV: true });
        multi.get(keys.lastStar(options.room));
        multi.get(keys.finalBlow(options.room));

        var replies = await multi.exec();

        var pids = [];
        var identifiers = [];
        var bossStatus;

        try {
            // zRangeWithScores returns array of objects: [{value: "pid", score: X}]
            if (replies[1] && replies[1].length > 0) {
                var topScorer = replies[1][0];
                identifiers.push({
                    identifier: "topScorer",
                    highlightScore: parseFloat(topScorer.score),
                    pid: topScorer.value
                });
            }
            if (replies[2] && replies[2].length > 0) {
                var topEnergy = replies[2][0];
                identifiers.push({
                    identifier: "topEnergy",
                    highlightScore: parseFloat(topEnergy.score),
                    pid: topEnergy.value
                });
            }
            if (replies[3]) {
                var lastStar = JSON.parse(replies[3]);
                identifiers.push({
                    identifier: "lastStar",
                    highlightScore: lastStar.score,
                    pid: lastStar.pid
                });
            }
            if (replies[4]) {
                var finalBlow = JSON.parse(replies[4]);
                identifiers.push({
                    identifier: "finalBlow",
                    highlightScore: finalBlow.score,
                    pid: finalBlow.pid
                });
            }
        } catch (err) {
            throw err;
        }

        for (var i = 0; i < identifiers.length; i++) {
            pids.push(identifiers[i].pid);
        }

        var highlights = [];
        
        // Only fetch dancer card info if we have pids
        if (pids.length > 0) {
            var dancerCardInfos = await wdfSessions.getPlayerInfo({
                room: options.room,
                pids: pids
            });

            if (dancerCardInfos && Array.isArray(dancerCardInfos)) {
                for (var i = 0; i < dancerCardInfos.length; i++) {
                    var highlight = dancerCardInfos[i];
                    if (highlight && identifiers[i]) {
                        highlight.__class = "BossEntry";
                        highlight.pid = identifiers[i].pid;
                        highlight.bossEntryType = identifiers[i].identifier;
                        highlight.score = identifiers[i].highlightScore;
                        highlights.push(highlight);
                    }
                }
            }
        }

        try {
            bossStatus = JSON.parse(replies[0]);
        } catch (err) {
            throw err;
        }

        if (!bossStatus) {
            throw new Error("No boss status data available for recap computation");
        }

        var recapData = {
            __class: "RecapInfo",
            bossStatus: {
                __class: "BossStatus",
                bossHealth: bossStatus.bossHealth < 0  ? 0 : bossStatus.bossHealth,
                bossMaxHealth: bossStatus.bossMaxHealth,
                previousRoundStars: bossStatus.previousRoundStars
            }
        };

        recapData.bossEntries = highlights;
        bossStatus.previousRoundStars = bossStatus.bossMaxHealth - bossStatus.bossHealth;

        options.state.bossState = bossStatus;

        var multi = redis.multi();
        multi.set(keys.recap(options.room), JSON.stringify(recapData));
        multi.set(keys.bossStatus(options.room), JSON.stringify(bossStatus));
        multi.set(keys.recapComputed(options.room), "true");

        await multi.exec();

        var beaten = (bossStatus.bossHealth <= 0);

        if (beaten || (options.state.currentRound >= options.state.playlistLength)) {
            var players = await wdfSessions.getPlayers({ room: options.room });

            await wdfStats.boss.put(options.room, {
                stars: bossStatus.previousRoundStars,
				familyName: options.state.familyName,
				bossName: options.state.bossName,
				bossFullName: options.state.bossFullName,
				level: options.state.playlistLength,
				beaten: beaten,
			    players: players,
				roomGameVersion: options.state.roomGameVersion
            });
        }

        await wdfLeaderboard.addPointsFromScore({
            room: options.room,
            playerScoresKey: keys.playerScores(options.room),
            roomGameVersion: options.state.roomGameVersion,
        });

        await clearPlayerScoreData(options);

        return;
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::boss::computeRecap()\nFailed to compute boss recap: ${err.message}`);
        throw err;
    }
};

// #TODO: get tracking data

const getRecap = async (options) => {
    try {
        var recapComputed = await redis.get(keys.recapComputed(options.room));
        if (recapComputed !== "true") {
            return {__class: "RecapInfo", recapComputed: false};
        }

        var data = await redis.get(keys.recap(options.room));

        var recapResponse;
        try {
            recapResponse = JSON.parse(data);
            recapResponse.recapComputed = true;
        } catch (err) {
            throw err;
        }
        
        var onlineRankInfo;
        if (options.gameVersion && options.gameVersion !== "jd2017") {
            onlineRankInfo = await wdfLeaderboard.getFormattedOnlineRankInfo({
                room: options.room,
                pid: options.pid
            });
        };

        return {
            ...recapResponse,
            onlineRankInfo: onlineRankInfo
        };
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::boss::getRecap()\nFailed to get boss recap: ${err.message}`);
        throw err;
    }
};

const updateScore = async (options) => {
    var recentStarPlayer = [];
    var bossStatus;

    // players current score
    var playerStars = Math.floor((options.score.score * 13333) / 2000);

    //Get the old score set the new score and get boss status
    var previousPlayerStars;
    try {
        var multi = redis.multi();
        

        multi.get(keys.bossStatus(options.room));
        multi.zScore(keys.playerScores(options.room), options.pid);
        multi.zAdd(keys.playerScores(options.room), { score: options.score.score, value: options.pid });
        multi.get(keys.recentStarPlayer(options.room));

        var replies = await multi.exec();

        try {
            bossStatus = JSON.parse(replies[0]);
            // this happens when some player sends us a score super late, when the next theme has started and the last boss theme cleaned up the keys
            if (!bossStatus) {
                throw new Error("No boss status data available for score update");
            }

            previousPlayerStars = replies [1] ? Math.floor((parseFloat(replies[1]) * 13333) / 2000) : 0;

            var recentPlayerStarData = JSON.parse(replies[3]);
            if (recentPlayerStarData) {
                recentStarPlayer.push(recentPlayerStarData);
            }
        } catch (err) {
            throw err;
        }
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::boss::updateScore()\nFailed to update boss score: ${err.message}`);
        throw err;
    }

    //Check if star was scored and update redis
    try {
        if (bossStatus) {
            var multi = redis.multi();

            if (previousPlayerStars < playerStars) {
                multi.set(keys.lastStar(options.room), JSON.stringify({ pid: options.pid, score: playerStars }));

                if (bossStatus.bossHealth < 1) {
                    multi.setNX(keys.finalBlow(options.room), JSON.stringify({ pid: options.pid, score: playerStars }));
                }

                if (options.score.energy) {
                    multi.zAdd(keys.playerEnergies(options.room), { score: options.score.energy, value: options.pid });
                }

                await multi.exec();
            }
        }
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::boss::updateScore()\nFailed to update boss star data: ${err.message}`);
        return {
            __class: "UpdateScoreResult",
            bossStatus: {
                __class: "BossStatus",
                bossHealth: 0,
                bossMaxHealth: 0,
                previousRoundStars: 0
            }
        }
    }

    return {
        __class: "UpdateScoreResult",
        bossStatus: {
            __class: "BossStatus",
            bossHealth: bossStatus.bossHealth < 0 ? 0 : bossStatus.bossHealth,
            bossMaxHealth: bossStatus.bossMaxHealth,
            previousRoundStars: bossStatus.previousRoundStars
        },
        bossEntries: recentStarPlayer
    };
};

const updateBossHealth = async (options) => {
    try {
        var reply = await redis.get(keys.bossStatus(options.room));

        if (!reply) {
            // Boss status not initialized yet - return the initial state from options if available
            if (options.state && options.state.bossState) {
                return options.state.bossState;
            }
            // No state available, return a default object
            return {
                bossHealth: 0,
                bossMaxHealth: 0,
                previousRoundStars: 0
            };
        }

        var bossStatus;
        try {
            bossStatus = JSON.parse(reply);
        } catch (err) {
            throw err;
        }

        var reply2 = await redis.zRangeWithScores(keys.playerScores(options.room), 0, -1, { REV: true });

        var stars = 0;
        for (var i = 0; i < reply2.length; i++) {
            try {
                var playerScore = parseFloat(reply2[i].score);
                stars += calculateStars(playerScore, options.state.roomGameVersion);
            } catch (err) {
                throw err;
            }
        }

        bossStatus.bossHealth = bossStatus.bossMaxHealth - (stars + bossStatus.previousRoundStars);
        await redis.set(keys.bossStatus(options.room), JSON.stringify(bossStatus));

        return bossStatus;
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::boss::updateBossHealth()\nFailed to update boss health: ${err.message}`);
        throw err;
    }
};

const getScoreStatus = async (options) => {
    try {
        var multi = redis.multi();

        multi.zScore(keys.playerScores(options.room), options.pid);
        multi.get(keys.bossStatus(options.room));

        var replies = await multi.exec();

        var bossStatus;
        var playerScore;

        try {
            playerScore = replies[0] ? parseFloat(replies[0]) : 0;
            bossStatus = JSON.parse(replies[1]);
        } catch (err) {
            throw err;
        }

        if (!bossStatus) {
            var dummyResponse = {
				score: 0,
				bossStatus: {
					__class: "BossStatus",
					bossHealth: 0,
					bossMaxHealth: 0,
					previousRoundStars: 0
				},
				__class: "InitScoreResult"
			};
            return dummyResponse;
        }

        return {
            score: playerScore,
            bossStatus: {
                __class: "BossStatus",
                bossHealth: bossStatus.bossHealth < 0 ? 0 : bossStatus.bossHealth,
                bossMaxHealth: bossStatus.bossMaxHealth,
                previousRoundStars: bossStatus.previousRoundStars
            },
            __class: "InitScoreResult"
        };
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::boss::getScoreStatus()\nFailed to get boss score status: ${err.message}`);
        throw err;
    }
};

const update = async (options) => {
    var bossStatus;
    try {
        var updatedBossStatus = await updateBossHealth(options);
        bossStatus = updatedBossStatus;
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::boss::update()\nFailed to update boss health during theme update: ${err.message}`);
        throw err;
    }

    //get the dancer card info of the last-star player and store it in recent-star-player if we have one
    try {
        var data = await redis.get(keys.lastStar(options.room));

        var lastStarPlayer;
        try {
            lastStarPlayer = JSON.parse(data);
        } catch (err) {
            throw err;
        }

        if (lastStarPlayer) {
            var dancerCardInfo = await wdfSessions.getPlayerInfo({
                room: options.room,
                pids: [lastStarPlayer.pid]
            });

            var recentStarPlayer = dancerCardInfo[0];
            recentStarPlayer.__class = "BossEntry";
            recentStarPlayer.pid = lastStarPlayer.pid;
            recentStarPlayer.score = lastStarPlayer.score;
            recentStarPlayer.bossEntryType = "recentStar";

            await redis.set(keys.recentStarPlayer(options.room), JSON.stringify(recentStarPlayer));
        }
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::boss::update()\nFailed to update recent star player during theme update: ${err.message}`);
        throw err;
    }

    try {
        var numberOfPlayers = await wdfSessions.getNumberOfPlayers(options);

        options.state.maxPlayersSeen = Math.max(numberOfPlayers, (options.state.maxPlayersSeen || 0));
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::boss::update()\nFailed to update max players seen during theme update: ${err.message}`);
        throw err;
    }

    return bossStatus;
};

const getPlayerScores = async (options) => {
    try {
        var reply = await redis.zRangeWithScores(keys.playerScores(options.room), 0, -1, { REV: true });

        var playerScores = [];

        for (var i = 0; i < reply.length; i++) {
            var score;
            try {
                score = parseFloat(reply[i].score);
            } catch (err) {
                throw err;
            }
            playerScores.push({
                pid: reply[i].value,
                score: score
            });
        }

        return playerScores;
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::boss::getPlayerScores()\nFailed to get player scores: ${err.message}`);
        throw err;
    }
};

const resetComputeRecap = async (options) => {
    await redis.set(keys.recapComputed(options.room), "false");
};


module.exports = {
    init,
    start,
    cleanUp,
    update,
    updateScore,
    getScoreStatus,
    getPlayerScores,
    resetComputeRecap,
    getRecap,
    computeRecap
};