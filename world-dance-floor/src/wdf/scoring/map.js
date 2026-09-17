/**
 * WORLD DANCE FLOOR - MAP SCORING LOGIC
 * 
 * Handles map theme scoring and related logic.
 */

const { getScoreRecap } = require("../themes/vote");

// External modules

// Internal modules
const logger = require("../../lib/logger").createLogger({ service: "wdf/scoring/map" });
const redis = require("../../lib/redis").client;

// WDF modules
var wdfSessions;
var wdfLeaderboard;


const playerScoresKey = (room) => {
    return `wdf:rooms:${room}:player-scores`;
};

const recapKey = (room) => {
    return `wdf:rooms:${room}:score-recap`;
};

const recapComputedKey = (room) => {
    return `wdf:rooms:${room}:recap-computed`;
};
 
const cleanUp = async (options) => {
    if (!options.room) return;

    const room = options.room;

    try {
        var multi = redis.multi();
        multi.del(playerScoresKey(room));
        multi.del(recapKey(room));
        multi.del(recapComputedKey(room));
        multi.exec();
    } catch (err) {
        logger.error(`[${room}] Error cleaning up room: ${err.message}\n${err.stack}`);
        return;
    }
};

const getPlayerScores = async (options) => {
    if (!options.room) return;

    const room = options.room;

    try {
        const reply = await redis.zRangeWithScores(playerScoresKey(room), 0, -1, { REV: true });

        var playerScores = [];

        for (var i = 0; i < reply.length; i++) {
            playerScores.push({
                pid: reply[i].value,
                score: reply[i].score,
            });
        }

        return playerScores;
    } catch (err) {
        logger.error(`[${room}] Error fetching player scores: ${err.message}\n${err.stack}`);
        return;
    }
};

const computeRecap = async (options) => {
    if (!options.room) return;

    const room = options.room;

    try {
        // log what's in player scores BEFORE copying
        const beforeScores = await redis.zRangeWithScores(playerScoresKey(room), 0, -1, { REV: true });
        //logger.debug(`[${room}] Player scores BEFORE computeRecap: ${JSON.stringify(beforeScores)}`);
        
        await wdfLeaderboard.addPointsFromScore({
            room: room,
            playerScoresKey: playerScoresKey(room),
            roomGameVersion: options.state.roomGameVersion
        })

        // copy scores to recap key
        const zunionResult = await redis.sendCommand(['ZUNIONSTORE', recapKey(room), '1', playerScoresKey(room)]);
        //logger.debug(`[${room}] ZUNIONSTORE result: ${zunionResult}`);
        
        // log what's in recap key AFTER copying
        const afterScores = await redis.zRangeWithScores(recapKey(room), 0, -1, { REV: true });
        //logger.debug(`[${room}] Recap scores AFTER ZUNIONSTORE: ${JSON.stringify(afterScores)}`);
        
        await redis.del(playerScoresKey(room));
        await redis.set(recapComputedKey(room), "true");
        
        return;
    } catch (err) {
        logger.error(`[${room}] Error computing recap: ${err.message}\n${err.stack}`);
        return;
    }
};

const createScoreObject = async (options) => {
    //logger.info(`[${options.room}] Creating score object with options ${JSON.stringify(options)}`);
    var pids = [];
    var scores = [];
    var pidsWithScores = options.pidsWithScores || options.playerScores;

    for (var i = 0; i < pidsWithScores.length; i+= 2) {
        if (pidsWithScores[i] !== "") pids.push(pidsWithScores[i]);
    }
    //logger.info(`[${options.room}] PIDs for dancer card info: ${JSON.stringify(pids)}`);

    try {
        var dancerCardInfos = await wdfSessions.getPlayerInfo({
            room: options.room,
            pids: pids
        });
        //logger.info(`[${options.room}] Dancer card infos: ${JSON.stringify(dancerCardInfos)}`);

        try {
            for (var i = 0; i < dancerCardInfos.length; i++) {
                var scoreObject = dancerCardInfos[i];
                scoreObject.__class = options.returnEntry;
                scoreObject.score = parseFloat(pidsWithScores[i * 2 + 1]);
                scoreObject.pid = pidsWithScores[i * 2];
                scores.push(scoreObject);
            }
            //logger.info(`[${options.room}] Scores array: ${JSON.stringify(scores)}`);
        } catch (err) {
            throw err;
        }

        var scoreInfos = {
            __class: options.returnContainer,
        };
        scoreInfos[options.rank] = options.currentRank;
        scoreInfos[options.scoreContainer] = scores;

        if (options.totalPlayers) {
            scoreInfos[options.totalPlayers] = options.playerCount;
        }
        //logger.info(`[${options.room}] Final score info object: ${JSON.stringify(scoreInfos)}`);

        return scoreInfos;
    } catch (err) {
        logger.error(`[${options.room}] Error creating score object: ${err.message}\n${err.stack}`);
        return;
    }
};

const getScoreInfo = async (options) => {
    if (!options.room) return;

    const room = options.room;

    var luaScript =`
            local newRank = redis.call('zrevrank', KEYS[1], ARGV[1]);
			if newRank == false then
				newRank = -1;
			end;
			local lowerLimit;
			lowerLimit = newRank <= 4 and 0 or newRank - 4;
			return {newRank ,redis.call('zrevrange', KEYS[1], lowerLimit, newRank + 4, 'WITHSCORES')}`;

    try {
        var value = await redis.eval(luaScript, { keys: [options.key], arguments: [options.pid] });

        value[0] = parseInt(value[0]) + 1;

        var pidsWithScores = value[1] || [];

        var scoreInfos = await createScoreObject({
            ...options,
            pidsWithScores: pidsWithScores,
            currentRank: value[0],
            rank: "currentRank"
        });

        return scoreInfos;
    } catch (err) {
        logger.error(`[${room}] Error fetching score info: ${err.message}\n${err.stack}`);
        return;
    }
};

const updateScore = async (options) => {
    if (!options.room) return;

    const room = options.room;

    try {
        var multi = redis.multi();
        multi.zAdd(playerScoresKey(room), {
            score: options.score.score,
            value: options.pid
        });
        multi.zCard(playerScoresKey(room));
        var results = await multi.exec();

        var scoreInfo = await getScoreInfo({
            ...options,
            key: playerScoresKey(room),
			scoreContainer: "scoreEntries", 
			returnEntry: "ScoreEntry", 
			returnContainer: "UpdateScoreResult"
        });

        if (!scoreInfo) {
            return null;
        }

        try {
            scoreInfo.totalPlayerCount = parseInt(results[1]);
        } catch (err) {
            throw err;
        }

        return scoreInfo;
    } catch (err) {
        logger.error(`[${room}] Error updating score for PID ${options.pid}: ${err.message}\n${err.stack}`);
        return;
    }

};

const getRecapForThisKey = async (options) => {
    if (!options.room) return;

    const room = options.room;

    var neighbourOneSidePlayerCount = 5;
	var topPlayerCount = 3;
	var bottomPlayerCount = 4;
	var maxNumberOfPlayers;
	var playerRank;
	var totalNumberOfPlayers;
	var key = options.key;

    try {
        var multi = redis.multi();
        multi.zRevRank(key, options.pid);
        multi.zCard(key);
        var value = await multi.exec();

        try {
            playerRank = value[0] === null ? -1 : parseInt(value[0]);
            totalNumberOfPlayers = parseInt(value[1]);
        } catch (err) {
            throw err;
        }

        var lowerLimit1 = 0;
		var upperLimit1 = topPlayerCount - 1;
		var lowerLimit2 = playerRank - neighbourOneSidePlayerCount;
		var upperLimit2 = playerRank + neighbourOneSidePlayerCount;
		var lowerLimit3 = totalNumberOfPlayers - bottomPlayerCount;
		var upperLimit3 = totalNumberOfPlayers - 1;
		var fetchAllPlayers = true;

		var neighbourBottomSidePlayerCount = neighbourOneSidePlayerCount;
		if (playerRank >= (totalNumberOfPlayers - bottomPlayerCount - neighbourOneSidePlayerCount))
			neighbourBottomSidePlayerCount =  totalNumberOfPlayers - playerRank - bottomPlayerCount - 1;
		
        maxNumberOfPlayers = topPlayerCount + neighbourOneSidePlayerCount + 1 + neighbourBottomSidePlayerCount + bottomPlayerCount;

        if (totalNumberOfPlayers > maxNumberOfPlayers) {
            fetchAllPlayers = false;

            if (playerRank <= (topPlayerCount + neighbourOneSidePlayerCount)) {
                lowerLimit2 = topPlayerCount;
                upperLimit2 = topPlayerCount + 2 * neighbourOneSidePlayerCount;
            } else if (playerRank >= (totalNumberOfPlayers - bottomPlayerCount - neighbourOneSidePlayerCount)) {
                upperLimit2 = totalNumberOfPlayers - bottomPlayerCount - 1;
            }
        }

        var multi2 = redis.multi();
        if (fetchAllPlayers) {
            multi2.zRangeWithScores(key, 0, -1, { REV: true });
        } else {
            multi2.zRangeWithScores(key, lowerLimit1, upperLimit1, { REV: true });
			multi2.zRangeWithScores(key, lowerLimit2, upperLimit2, { REV: true });
			multi2.zRangeWithScores(key, lowerLimit3, upperLimit3, { REV: true });
        }

        var results2 = await multi2.exec();

        var pidsWithScores = [];

        // Convert from [{value, score}] format to flat [value, score, value, score] format
        function flattenScores(scoresArray) {
            var flat = [];
            if (scoresArray && scoresArray.length) {
                for (var j = 0; j < scoresArray.length; j++) {
                    if (typeof scoresArray[j] === 'object' && scoresArray[j].value !== undefined) {
                        flat.push(scoresArray[j].value);
                        flat.push(String(scoresArray[j].score));
                    }
                }
            }
            return flat;
        }

        if (fetchAllPlayers) {
            pidsWithScores = flattenScores(results2[0]);
        } else {
            if (results2[0]) {
                pidsWithScores = pidsWithScores.concat(flattenScores(results2[0]));
            }
            if (results2[1]) {
                pidsWithScores = pidsWithScores.concat(flattenScores(results2[1]));
            }
            if (results2[2]) {
                pidsWithScores = pidsWithScores.concat(flattenScores(results2[2]));
            }
        }

        var scoreInfos = await createScoreObject({
            ...options,
            pidsWithScores: pidsWithScores,
            currentRank: playerRank + 1,
            rank: options.rank,
            totalPlayers: options.totalPlayers,
            playerCount: totalNumberOfPlayers
        });

        return scoreInfos;
    } catch (err) {
        logger.error(`[${room}] Error fetching recap: ${err.message}\n${err.stack}`);
        return;
    }
};

const getRecap = async (options) => {
    var recapComputed = await redis.get(recapComputedKey(options.room));

    if (recapComputed !== "true") {
        return {
            __class: "RecapInfo",
            recapComputed: false
        };
    }

    async function recap() {
        try {
            const recapComputed = await redis.get(recapComputedKey(options.room));

            if (recapComputed !== "true") {
                return {
                    __class: "RecapInfo",
                    recapComputed: false
                };
            }

            async function recap() {
                try {
                    var recapReply = await getRecapForThisKey({
                        ...options,
                        key: recapKey(options.room),
                        rank: "currentRank",
                        totalPlayers: "totalPlayerCount", 
                        scoreContainer: "recapEntries", 
                        returnEntry: "RecapEntry", 
                        returnContainer: "RecapInfo"
                    });

                    recap.recapComputed = true;
                    return recapReply;
                } catch (err) {
                    throw err;
                }
            }

            async function recapOnlineRankInfo() {
                try {
                    if (options.gameVersion && options.gameVersion !== "jd2017") {
                        var onlineRankInfo = await wdfLeaderboard.getFormattedOnlineRankInfo({
                            room: options.room,
                            pid: options.pid,
                        });

                        return {
                            onlineRankInfo: onlineRankInfo
                        };
                    }
                } catch (err) {
                    throw err;
                }
            }

            var recapReply = await recap();
            var onlineRankInfoReply = await recapOnlineRankInfo();

            return {
                ...recapReply,
                ...onlineRankInfoReply
            };
        } catch (err) {
            logger.error(`[${options.room}] Error getting recap: ${err.message}\n${err.stack}`);
            return;
        }
    }

    async function recapOnlineRankInfo() {
        try {
            if (options.gameVersion && options.gameVersion !== "jd2017") {
                var onlineRankInfo = await wdfLeaderboard.getFormattedOnlineRankInfo({
                    room: options.room,
                    pid: options.pid,
                });

                return {
                    onlineRankInfo: onlineRankInfo
                };
            }

            return null;
        } catch (err) {
            logger.error(`[${options.room}] Error getting online rank info: ${err.message}\n${err.stack}`);
            return;
        }
    }

    try {
        var recapReply = await recap();
        var onlineRankInfoReply = await recapOnlineRankInfo();

        return {
            ...recapReply,
            ...onlineRankInfoReply,
            recapComputed: true
        };
    } catch (err) {
        logger.error(`[${options.room}] Error getting recap and online rank info: ${err.message}\n${err.stack}`);
        return;
    }
};

const getScoreStatus = async (options) => {
    if (!options.room) return;

    const room = options.room;

    try {
        var result = await getScoreInfo({
            ...options,
            key: playerScoresKey(room),
            scoreContainer: "scoreEntries",
            returnEntry: "ScoreEntry",
            returnContainer: "InitScoreResult"
        });

        var scoreEntries = result.scoreEntries;
        var score = 0;

        for (var i = 0; i < scoreEntries.length; i++) {
            if (scoreEntries[i].pid === options.pid) {
                score = scoreEntries[i].score;
                break;
            }
        }

        result.score = score;

        return result;
    } catch (err) {
        logger.error(`[${room}] Error getting score status for PID ${options.pid}: ${err.message}\n${err.stack}`);
        return;
    }
};

const resetComputeRecap = async (options) => {
    if (!options.room) return;

    const room = options.room;

    try {
        await redis.set(recapComputedKey(room), "false");
    } catch (err) {
        logger.error(`[${room}] Error resetting recap computation: ${err.message}\n${err.stack}`);
        return;
    }
};

const getStars = async (options) => {
    try {
        var playerScores = await getPlayerScores(options);

        var stars = 0;

        playerScores.forEach((playerScore) => {
            stars += Math.floor((playerScore.score * 13333)/2000);
        });
        
        return stars;
    } catch (err) {
        logger.error(`Error getting stars: ${err.message}\n${err.stack}`);
        return 0;
    }
};

const init = (clients) => {
    wdfSessions = clients.wdfSessions;
    wdfLeaderboard = clients.wdfLeaderboard;
    return;
};


module.exports = {
    cleanUp,
    getPlayerScores,
    computeRecap,
    updateScore,
    getRecap,
    getScoreRecap: getRecap,
    getScoreStatus,
    resetComputeRecap,
    getStars,
    init,
};