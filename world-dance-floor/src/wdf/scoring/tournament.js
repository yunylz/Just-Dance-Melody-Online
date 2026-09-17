// External modules

// Internal modules
const cache = require("../../lib/cache");
const logger = require("../../lib/logger").createLogger({ service: "wdf/scoring/tournament" });
const redis = require("../../lib/redis").client;

// WDF modules
const wdfConfig = cache.file("/data/config.json").config;
var wdfSessions;
var wdfLeaderboard;

var keys = {
	playerScores: function(room) { return "wdf:rooms:" + room + ":player-scores"; },
	recap: function(room) { return "wdf:rooms:" + room + ":score-recap"; },
	tournamentRecap: function(room) { return "wdf:rooms:" + room + ":tournament-recap"; },
	recapComputed: function(room) { return "wdf:rooms:" + room + ":recap-computed"; },
	tournamentType: function(room) { return "wdf:rooms:" + room + ":tournament-type";},
	eswcTournamentPlayerData : function(room) { return "wdf:rooms:" + room + ":eswcTournamentPlayerData";}
};

const init = (clients) => {
    wdfSessions = clients.wdfSessions;
    wdfLeaderboard = clients.wdfLeaderboard;
    return;
};

const start = async (options) => {
    try {
        await redis.set(keys.tournamentType(options.room), options.state.tournamentType);
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::tournament::start()\nFailed to set tournament type: ${err.message}`);
        throw err;
    }
};

const cleanUp = async (options) => {
    if (!options.room) throw new Error("No room provided");
    try {
        var multi = redis.multi();
        multi.del(keys.playerScores(options.room));
        multi.del(keys.tournamentRecap(options.room));
        multi.del(keys.recap(options.room));
        multi.del(keys.recapComputed(options.room));
        multi.del(keys.tournamentType(options.room));
        multi.del(keys.eswcTournamentPlayerData(options.room));
        await multi.exec();
        return;
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::tournament::cleanUp()\nFailed to clean up tournament data: ${err.message}`);
        throw err;
    }
};

const computeRecap = async (options) => {
    if (!options.room) {
        logger.error(`computeRecap called without room parameter. Options: ${JSON.stringify(options)}`);
        throw new Error("Room parameter is required for computeRecap");
    }

    try {
        await wdfLeaderboard.addPointsFromScore({
            room: options.room,
            playerScoresKey: keys.playerScores(options.room),
            roomGameVersion: options.state.roomGameVersion
        })
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::tournament::computeRecap()\nFailed addPointsFromScore: ${err.message}`);
        throw err;
    }

    try {
        var playerScoresKey = keys.playerScores(options.room);
        var recapKey = keys.recap(options.room);
        var tournamentRecapKey = keys.tournamentRecap(options.room);
        var recapComputedKey = keys.recapComputed(options.room);

        await redis.zUnionStore(recapKey, [playerScoresKey]);
        await redis.zUnionStore(tournamentRecapKey, [tournamentRecapKey, recapKey], { AGGREGATE: "SUM" });
        // playerScores will be deleted at the start of the next round in resetComputeRecap
        // This ensures only players who actually submit scores each round are counted
        await redis.set(recapComputedKey, "true");
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::tournament::computeRecap()\nFailed multi: ${err.message}`);
        throw err;
    }

    try {
        if (options.state.currentRound === options.state.playlistLength) { // last map's recap
            var pids = await redis.zRange(keys.tournamentRecap(options.room), 0, 2, { REV: true });

            var pidsWithPoints = {};
            if (pids[0]) pidsWithPoints[pids[0]] = 40 * options.state.playlistLength; // 1st place
            if (pids[1]) pidsWithPoints[pids[1]] = 25 * options.state.playlistLength; // 2nd place
            if (pids[2]) pidsWithPoints[pids[2]] = 15 * options.state.playlistLength; // 3rd place

            await wdfLeaderboard.addPointsFromMapping({
                room: options.room,
                pidsWithPoints: pidsWithPoints,
                roomGameVersion: options.state.roomGameVersion
            });
        }
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::tournament::computeRecap()\nFailed addPointsFromMapping: ${err.message}`);
        throw err;
    }
};

const createScoreObject = async (options) => {
    var pids = [];
    var scores = [];
    var pidsWithScores = options.pidsWithScores;
    
    // Handle both formats: 
    // 1. Object array from zRangeWithScores: [{value: "pid", score: X}, ...]
    // 2. Flat array from Lua WITHSCORES: ["pid1", "score1", "pid2", "score2", ...]
    var isObjectFormat = pidsWithScores.length > 0 && typeof pidsWithScores[0] === 'object';
    
    if (isObjectFormat) {
        for (var i = 0; i < pidsWithScores.length; i++) {
            if (pidsWithScores[i] && pidsWithScores[i].value) {
                pids.push(pidsWithScores[i].value);
            }
        }
    } else {
        for (var i = 0; i < pidsWithScores.length; i += 2) {
            if (pidsWithScores[i] !== "") pids.push(pidsWithScores[i]);
        }
    }

    // If no valid pids, return empty result
    if (pids.length === 0) {
        var scoreInfos = {
            "__class": options.returnContainer
        };
        scoreInfos[options.rank] = options.currentRank;
        scoreInfos[options.scoreContainer] = [];
        if (options.totalPlayers) {
            scoreInfos[options.totalPlayers] = options.playerCount;
        }
        return scoreInfos;
    }

    try {
        var dancerCardInfos = await wdfSessions.getPlayerInfo({
            room: options.room,
            pids: pids
        });

        if (!dancerCardInfos || !Array.isArray(dancerCardInfos)) {
            dancerCardInfos = [];
        }

        for (var i = 0; i < dancerCardInfos.length; i++) {
            var scoreObject = dancerCardInfos[i];
            if (!scoreObject) continue;
            
            scoreObject.__class = options.returnEntry;
            if (isObjectFormat) {
                scoreObject.pid = pidsWithScores[i].value;
                scoreObject.score = parseFloat(pidsWithScores[i].score);
            } else {
                scoreObject.pid = pidsWithScores[i * 2];
                scoreObject.score = parseFloat(pidsWithScores[i * 2 + 1]);
            }
            scores.push(scoreObject);
        }

        var scoreInfos = {
            "__class": options.returnContainer
        };

        scoreInfos[options.rank] = options.currentRank;
        scoreInfos[options.scoreContainer] = scores;
        if (options.totalPlayers) {
            scoreInfos[options.totalPlayers] = options.playerCount;
        }

        return scoreInfos;
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::tournament::createScoreObject()\nFailed to create score object: ${err.message}`);
        throw err;
    }
};

const getScoreInfo = async (options) => {
    var luaScript = "local newRank = redis.call('zrevrank', KEYS[1], ARGV[1]); if newRank == false then newRank = -1; end; local lowerLimit; lowerLimit = newRank <= 4 and 0 or newRank - 4; return {newRank ,redis.call('zrevrange', KEYS[1], lowerLimit, newRank + 4, 'WITHSCORES')}";

    try {
        var value = await redis.eval(luaScript, {
            keys: [ options.key ],
            arguments: [ options.pid ]
        });

        // player's current rank
        value[0] = parseInt(value[0]) + 1;

        // get dancercard infos
        var pidsWithScores = value[1];
        var scoreInfo = await createScoreObject({
            ...options,
            pidsWithScores: pidsWithScores,
            currentRank: value[0],
            rank: "currentRank",
        });

        return scoreInfo;
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::tournament::getScoreInfo()\nFailed to get score info: ${err.message}`);
        throw err;
    }
};

const updateScore = async (options) => {
    try {
        var playerScoresKey = keys.playerScores(options.room);
        var tournamentTypeKey = keys.tournamentType(options.room);

        //logger.debug(`[${options.room}] updateScore keys: playerScores=${playerScoresKey}, tournamentType=${tournamentTypeKey}`);
        //logger.debug(`[${options.room}] updateScore values: score=${options.score.score}, pid=${options.pid}`);

        var multi = redis.multi();

        multi.get(tournamentTypeKey);
        multi.zAdd(playerScoresKey, { score: options.score.score, value: options.pid });
        multi.zCard(playerScoresKey);

        var results = await multi.exec();
        
        //logger.debug(`[${options.room}] Score saved. Player count in playerScores: ${results[2]}`);

        var scoreInfo = await getScoreInfo({
            ...options,
            key: keys.playerScores(options.room),
			scoreContainer: "scoreEntries", 
			returnEntry: "ScoreEntry", 
			returnContainer: "UpdateScoreResult"
        });

        // total player count
        scoreInfo.totalPlayers = parseInt(results[2]);

        //# TODO: ESWC data processing

        return scoreInfo;
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::tournament::updateScore()\nFailed to update score: ${err.message}`);
        throw err;
    }
};

const getRecapForThisKey = async (options) => {
    var neighbourOneSidePlayerCount = wdfConfig.WDF_RECAP_ADJACENT_PLAYER_COUNT;
	var topPlayerCount = wdfConfig.WDF_RECAP_TOP_PLAYERS_COUNT;
	var bottomPlayerCount = wdfConfig.WDF_RECAP_BOTTOM_PLAYERS_COUNT;
	var maxNumberOfPlayers;
	var playerRank;
	var totalNumberOfPlayers;
	var key = options.key;

    //get player rank, total number of players scored
    try {
        var multi = redis.multi();
        multi.zRevRank(key(options.room), options.pid);
        multi.zCard(key(options.room));
        var value = await multi.exec();

        try {
            playerRank = value[0] === null? -1 : parseInt(value[0]);
            totalNumberOfPlayers = parseInt(value[1]);
        } catch (err) {
            throw new Error("Failed to parse rank or total players");
        }
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::tournament::getRecapForThisKey()\nFailed to get player rank and total players: ${err.message}`);
        throw err;
    }

    try {
        //make some initializations
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
			if (playerRank <= topPlayerCount + neighbourOneSidePlayerCount) {
				lowerLimit2 = topPlayerCount;
				upperLimit2 = topPlayerCount + 2 * neighbourOneSidePlayerCount;
			}
			else if (playerRank >= totalNumberOfPlayers - bottomPlayerCount - neighbourOneSidePlayerCount) {
				upperLimit2 = totalNumberOfPlayers - bottomPlayerCount - 1;
			}
		}

        var multi = redis.multi();

        if (fetchAllPlayers) {
            multi.zRangeWithScores(key(options.room), 0, -1, { REV: true });
        } else {
            multi.zRangeWithScores(key(options.room), lowerLimit1, upperLimit1, { REV: true });
            multi.zRangeWithScores(key(options.room), lowerLimit2, upperLimit2, { REV: true });
            multi.zRangeWithScores(key(options.room), lowerLimit3, upperLimit3, { REV: true });
        }

        var value = await multi.exec();

        var pidsWithScores = [];
        if(value[0].length) pidsWithScores = pidsWithScores.concat(value[0]);
		if(value[1] && value[1].length) pidsWithScores = pidsWithScores.concat(value[1]);
		if(value[2] && value[2].length) pidsWithScores = pidsWithScores.concat(value[2]);

        var scoreInfo = await createScoreObject({
            ...options,
            pidsWithScores: pidsWithScores,
            currentRank: playerRank + 1,
            playerCount: totalNumberOfPlayers,
            rank: options.rank,
            totalPlayers: options.totalPlayers
        });

        return scoreInfo;
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::tournament::getRecapForThisKey()\nFailed to get recap score info: ${err.message}`);
        throw err;
    }
};

const getRecap = async (options) => {
    try {
        var recapComputed = await redis.get(keys.recapComputed(options.room));
        if (recapComputed !== "true") {
            return {__class: "RecapInfo", recapComputed: false};
        }

        //get track recap
        var optionsClone = { ...options };
        var recapOne = await getRecapForThisKey({
            ...optionsClone,
            key: keys.recap,
            rank: "currentRank",
            totalPlayers: "totalPlayerCount",
            scoreContainer: "recapEntries",
            returnEntry: "RecapEntry",
            returnContainer: "RecapInfo"
        });

        //get tournament recap
        var recapTwo = await getRecapForThisKey({
            ...optionsClone,
            key: keys.tournamentRecap,
            rank: "tournamentRank",
            totalPlayers: "tournamentTotalPlayerCount",
            scoreContainer: "tournamentRecapEntries",
            returnEntry: "RecapEntry",
            returnContainer: "RecapInfo"
        });

        var onlineRankInfo;
        if (options.gameVersion && options.gameVersion !== "jd2017") {
            onlineRankInfo = await wdfLeaderboard.getFormattedOnlineRankInfo({
                room: options.room,
                pid: options.pid
            });
        } else {
            onlineRankInfo = null;
        }

        return {
            ...recapOne,
            ...recapTwo,
            onlineRankInfo,
            recapComputed: true
        };
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::tournament::getRecap()\nFailed to get recap: ${err.message}`);
        throw err;
    }
};

const getScoreStatus = async (options) => {
    try {
        var result = await getScoreInfo({
            ...options,
            key: keys.playerScores(options.room),
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
        logger.error(`[${options.room}] wdfScoring::tournament::getScoreStatus()\nFailed to get score status: ${err.message}`);
        throw err;
    }
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
                throw new Error("Failed to parse score");
            }
            playerScores.push({
                pid: reply[i].value,
                score: score
            });
        }

        return playerScores;
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::tournament::getPlayerScores()\nFailed to get player scores: ${err.message}`);
        throw err;
    }
};

const getTournamentWinner = async (options) => {
    try {
        var tournamentWinnerPid = await redis.zRange(keys.tournamentRecap(options.room), 0, 0, { REV: true });

        if (tournamentWinnerPid.length === 0) return;

        tournamentWinnerPid = tournamentWinnerPid[0];

        return tournamentWinnerPid;
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::tournament::getTournamentWinner()\nFailed to get tournament winner: ${err.message}`);
        throw err;
    }
};

const getTournamentScores = async (options) => {
    try {
        var multi = redis.multi();

        multi.zUnionStore(keys.tournamentRecap(options.room) + ":temp", [ keys.playerScores(options.room), keys.tournamentRecap(options.room) ], { AGGREGATE: "SUM" });
        multi.zRangeWithScores(keys.tournamentRecap(options.room) + ":temp", 0, -1, { REV: true });
        multi.del(keys.tournamentRecap(options.room) + ":temp");

        var replies = await multi.exec();

        var tournamentScores = [];

        var tournamentRecapScores = replies[1];

        // zRangeWithScores returns array of objects: [{value: "pid", score: X}, ...]
        for (var i = 0; i < tournamentRecapScores.length; i++) {
            var score;
            try {
                score = parseFloat(tournamentRecapScores[i].score);
            } catch (err) {
                throw err;
            }
            tournamentScores.push({pid: tournamentRecapScores[i].value, score: score});
        }

        return tournamentScores;
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::tournament::getTournamentScores()\nFailed to get tournament scores: ${err.message}`);
        throw err;
    }
};

const resetComputeRecap = async (options) => {
    try {
        // Delete playerScores at the start of each round
        // This ensures only players who actually submit scores this round are counted
        // tournamentRecap is preserved - it accumulates across all rounds
        await redis.del(keys.playerScores(options.room));
        await redis.set(keys.recapComputed(options.room), "false");
        logger.debug(`[${options.room}] Reset playerScores for new round`);
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::tournament::resetComputeRecap()\nFailed to reset recap computed flag: ${err.message}`);
        throw err;
    }
};

const getStars = async (options) => {
    try {
        var playerScores = await getTournamentScores(options);

        var stars = 0;
        
        playerScores.forEach((player) => {
            stars += Math.floor((player.score * 13333)/2000)
        })

        return stars;
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::tournament::getStars()\nFailed to get stars: ${err.message}`);
        throw err;
    }
};

const getESWCData = async (options) => {
    try {
        var eswcData = await redis.hGetAll(keys.eswcTournamentPlayerData(options.room));
        return eswcData || {};
    } catch (err) {
        logger.error(`[${options.room}] wdfScoring::tournament::getESWCData()\nFailed to get ESWC data: ${err.message}`);
        throw err;
    }
};

const getTournamentType = async (room) => {
    try {
        var tournamentType = await redis.get(keys.tournamentType(room));
        return tournamentType;
    } catch (err) {
        logger.error(`[${room}] wdfScoring::tournament::getTournamentType()\nFailed to get tournament type: ${err.message}`);
        throw err;
    }
};

module.exports = {
    init,
    start,
    cleanUp,
    computeRecap,
    updateScore,
    getRecap,
    getScoreStatus,
    getPlayerScores,
    getTournamentWinner,
    getTournamentScores,
    resetComputeRecap,
    getStars,
    getESWCData,
    getTournamentType
};