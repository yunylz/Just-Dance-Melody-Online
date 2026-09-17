// External modules

// Internal modules
const cache = require("../lib/cache");
const logger = require("../lib/logger").createLogger({ service: "wdf/leaderboard" });
const redis = require("../lib/redis").client;

// WDF modules
const wdfConfig = cache.file("/data/config.json").config;
var wdfSessions;

var unsupportedGameVersions = [ "jd2017" ];
var wdfPointsByScoreRange = { 
    "0": 10,
    "1": 11,
    "2": 13,
    "3": 14,
    "4": 16,
    "5": 18,
    "6": 20,
    "7": 23,
    "8": 26,
    "9": 29,
    "10": 32,
    "11": 37,
    "12": 41,
    "13": 46
};


const init = (clients) => {
    wdfSessions = clients.wdfSessions;

    return;
};

const currentSeasonDetailsKey = (room) => {
    return `wdf:rooms:${room}:lb:current-season-details`;
};

const currentSeasonLbKey = (room) => {
    return `wdf:rooms:${room}:lb:current-season`;
};

const previousSeasonLbKey = (room) => {
    return `wdf:rooms:${room}:lb:previous-season`;
};

const lbPlayerInfosKey = (room) => {
    return `wdf:rooms:${room}:lb:player-infos`;
};

const resetLbKey = (room) => {
    return `wdf:rooms:${room}:lb:reset`;
};

const wdfRankingKey = (gameVersion) => {
    return `wdf:rankings:${gameVersion}`;
};

const getCurrentSeasonDetails = async (options) => {
    try {
        const reply = await redis.get(currentSeasonDetailsKey(options.room));

        if (!reply) {
            return null;
        }

        try {
            return JSON.parse(reply);
        } catch (err) {
            throw err;
        }
    } catch (err) {
        logger.error(`[${options.room}] wdfLeaderboard::getCurrentSeasonDetails()\nError fetching current season details: ${err.message}\n${err.stack}`);
        return;
    }
};

const addPoints = async (options) => {
    if (!options.room || !options.pid || typeof options.points !== "number") return;

    const room = options.room;
    const pid = options.pid;
    const points = options.points;

    try {
        var playerInfos = await wdfSessions.getPlayerInfo({
            room: room,
            pids: [ pid ]
        });

        var playerInfo = playerInfos[0];
        playerInfo.pid = options.pid;

        var multi = redis.multi();
        multi.zIncrBy(currentSeasonLbKey(room), points, pid);
        multi.hSet(lbPlayerInfosKey(room), pid, JSON.stringify(playerInfo));
        await multi.exec((err) => {
            if (err) {
                throw err;
            }
        });

        return;
    } catch (err) {
        logger.error(`[${room}] wdfLeaderboard::addPoints()\nError adding points to player ${pid}: ${err.message}\n${err.stack}`);
        return;
    }
};

const addPointsFromMapping = async (options) => {
    if (unsupportedGameVersions.indexOf(options.roomGameVersion) !== -1) {
        return;
    }

    function isSeasonRunning(currentSeasonDetails) {
        var now = Date.now();
        var isRunning = currentSeasonDetails && now > currentSeasonDetails.startTime;
        logger.debug(`[${options.room}] isSeasonRunning check: now=${now}, startTime=${currentSeasonDetails?.startTime}, isRunning=${isRunning}`);
        return isRunning;
    }

    try {
        var currentSeasonDetails = await getCurrentSeasonDetails({ room: options.room });

        if (isSeasonRunning(currentSeasonDetails)) {
            var pidsWithPoints = options.pidsWithPoints;
            var pids = Object.keys(pidsWithPoints);
            logger.debug(`[${options.room}] Adding points for ${pids.length} players`);
            
            for (var i = 0; i < pids.length; i++) {
                var pid = pids[i];
                await addPoints({
                    room: options.room,
                    pid: pid,
                    points: pidsWithPoints[pid]
                });
            }

            return;
        } else {
            logger.info(`[${options.room}] Season is not running, skipping adding points.`);
        }

        return;
    } catch (err) {
        logger.error(`[${options.room}] wdfLeaderboard::addPointsFromMapping()\nError adding points from mapping: ${err.message}\n${err.stack}`);
        return;
    }
};

const addPointsFromScore = async (options) => {
    if (!options.room || !options.roomGameVersion) return;

    const room = options.room;
    const roomGameVersion = options.roomGameVersion;

    if (unsupportedGameVersions.indexOf(options.roomGameVersion) !== -1) {
        return;
    }

    async function getPlayerScores(playerScoresKey) {
        try {
            const reply = await redis.zRangeWithScores(playerScoresKey, 0, -1, {
                REV: true
            });

            var playerScores = [];

            // zRangeWithScores returns array of objects: [{value: "pid", score: X}, ...]
            for (var i = 0; i < reply.length; i++) {
                var entry = reply[i];
                playerScores.push({
                    pid: entry.value,
                    score: parseFloat(entry.score),
                });
            }

            logger.debug(`[${room}] getPlayerScores: Found ${playerScores.length} players with scores`);

            return playerScores;
        } catch (err) {
            logger.error(`[${room}] wdfLeaderboard::getPlayerScores()\nError fetching player scores from key ${playerScoresKey}: ${err.message}\n${err.stack}`);
            throw err;
        }
    }

    async function process(pidsWithScores) {
        var pidsWithPoints = {};

        for (var i = 0; i < pidsWithScores.length; i++) {
            var score = pidsWithScores[i].score;

            if (score < 0 || score > 1.0) {
                logger.warn(`[${room}] Invalid score ${score} for player ${pidsWithScores[i].pid}, skipping.`);
                score = 0;
            }

            score = score * 13333;

            var pointsIndex = Math.floor(score / 1000);

            if (score % 1000 === 0) pointsIndex--;

            pidsWithPoints[pidsWithScores[i].pid] = score > 0 ? wdfPointsByScoreRange[pointsIndex.toString()] || 0 : 0;
        }

        await addPointsFromMapping({
            room: room,
            roomGameVersion: roomGameVersion,
            pidsWithPoints: pidsWithPoints
        }).then((reply) => {
            return reply;
        }).catch((err) => {
            throw err;
        });
    }

    if (options.pidsWithScores) {
        var reply = await process(options.pidsWithScores);
        return reply;
    }

    if (!options.playerScoresKey) {
        throw new Error("Either pidsWithScores or playerScoresKey must be provided.");
    }

    try {
        var pidsWithScores = await getPlayerScores(options.playerScoresKey);
        var reply = await process(pidsWithScores);
        return reply;
    } catch (err) {
        logger.error(`[${room}] wdfLeaderboard::addPointsFromScore()\nError adding points from score: ${err.message}\n${err.stack}`);
        return;
    }
};

const getPlayerInfos = async (options) => {
    try {
        var multi = redis.multi();

        options.pids.forEach((pid) => {
            multi.hGet(lbPlayerInfosKey(options.room), pid);
        });

        var playerInfos = await multi.exec();

        for (var i = 0; i < playerInfos.length; i++) {
            try {
                playerInfos[i] = JSON.parse(playerInfos[i]);
            } catch (err) {
                throw err;
            }
        }

        return playerInfos;
    } catch (err) {
        logger.error(`[${options.room}] wdfLeaderboard::getPlayerInfos()\nError fetching player infos: ${err.message}\n${err.stack}`);
        return;
    }
};

const getLbLen = async (lbKey) => {
    try {
        const reply = await redis.zCard(lbKey);

        var len;
        try {
            len = parseInt(reply);
        } catch (err) {
            throw err;
        }

        return len;
    } catch (err) {
        logger.error(`wdfLeaderboard::getLbLen()\nError fetching leaderboard length for '${lbKey}': ${err.message}\n${err.stack}`);
        return;
    }
};

const getLbFromKey = async (lbKey, options) => {
    if (!lbKey || !options) return;

    async function getPlayerRank(lbLen) {
        if (options.pid) {
            try {
                const rankReply = await redis.zRevRank(lbKey, options.pid);

                var rank;
                if (rankReply !== null) {
                    try {
                        rank = parseInt(rankReply);
                    } catch (err) {
                        throw err;
                    }
                }

                if (isNaN(rank)) {
                    return null;
                }
                
                return rank;
            } catch (err) {
                throw err;
            }
        }
        
        if (options.rank) {
            if (options.rank < 0) {
                return lbLen + options.rank;
            }
            return options.rank - 1;
        }
        return null;
    }

    try {
        const lbLen = await getLbLen(lbKey);
        const rank = await getPlayerRank(lbLen);
        
        var startingRank;
        var pidsWithPoints;

        var zrevrangeStart = 0, zrevrangeStop = -1;

        if (options.pid && rank === null) {
            startingRank = rank;
            pidsWithPoints = []; // pid not found in the LB
        }
        else if (rank !== null) {
            if (options.above < 0 || options.below < 0) {
                throw new Error("above and below must be non-negative.");
            }

            zrevrangeStart = Math.max(rank - (options.above || 0), 0);
            zrevrangeStop = rank + (options.below || 0); // redis will handle STOP being beyond the end of the sorted set

            var values = await redis.zRangeWithScores(lbKey, zrevrangeStart, zrevrangeStop, { REV: true });

            startingRank = zrevrangeStart + 1;
            pidsWithPoints = values;
        }
        else {
            // No specific pid and no rank specified - get top entries
            var values = await redis.zRangeWithScores(lbKey, zrevrangeStart, zrevrangeStop, { REV: true });
            
            startingRank = zrevrangeStart + 1;
            pidsWithPoints = values;
        }
        
        var lb = [];
        var pids = [];

        // zRangeWithScores returns array of objects: [{value: "pid", score: X}, ...]
        for (var i = 0; i < pidsWithPoints.length; i++) {
            var entry = pidsWithPoints[i];
            var pid = entry.value;
            var wdfPoints = parseInt(entry.score);
            
            pids.push(pid);
            lb.push({
                wdfPoints: wdfPoints,
            });
        }

        var playerInfos = await getPlayerInfos({
            room: options.room,
            pids: pids
        });

        for (var j = 0; j < lb.length; j++) {
            var lbEntry = lb[j];
            lbEntry.dc = playerInfos[j];
            lbEntry.rank = startingRank + j;
        }

        return lb;
    } catch (err) {
        logger.error(`wdfLeaderboard::getLbFromKey()\nError fetching leaderboard from key ${lbKey}: ${err.message}\n${err.stack}`);
        return;
    }
};

const getLb = async (options) => {
    if (!options.room) return;

    const room = options.room;

    try {
        const lb = await getLbFromKey(currentSeasonLbKey(room), options);
        return lb;
    } catch (err) {
        logger.error(`[${options.room}] wdfLeaderboard::getLb()\nError fetching leaderboard: ${err.message}\n${err.stack}`);
        return;
    }
};

const getLbPreviousSeason = async (options) => {
    if (!options.room) return;

    const room = options.room;

    try {
        const lb = await getLbFromKey(previousSeasonLbKey(room), options);
        return lb;
    } catch (err) {
        logger.error(`[${options.room}] wdfLeaderboard::getLbPreviousSeason()\nError fetching previous season leaderboard: ${err.message}\n${err.stack}`);
        return;
    }
};

const getCurrentSeasonLbLen = async (options) => {
    if (!options.room) return;

    const room = options.room;

    try {
        const len = await getLbLen(currentSeasonLbKey(room));
        return len;
    } catch (err) {
        logger.error(`[${options.room}] wdfLeaderboard::getCurrentSeasonLbLen()\nError fetching current season leaderboard length: ${err.message}\n${err.stack}`);
        return;
    }
};

const getPreviousSeasonLbLen = async (options) => {
    if (!options.room) return;

    const room = options.room;
    
    try {
        const len = await getLbLen(previousSeasonLbKey(room));
        return len;
    } catch (err) {
        logger.error(`[${options.room}] wdfLeaderboard::getPreviousSeasonLbLen()\nError fetching previous season leaderboard length: ${err.message}\n${err.stack}`);
        return;
    }
};

const getFormattedOnlineRankInfo = async (options) => {
    try {
        const lb = await getLb({
            room: options.room,
            pid: options.pid,
        });

        var onlineRankInfo = {};

        if (lb[0]) {
            onlineRankInfo = {
                "__class": "WDFOnlineRankInfo",
                "rank": lb[0].rank,
                "wdfPoints": lb[0].wdfPoints
            };
        }

        return onlineRankInfo;
    } catch (err) {
        logger.error(`[${options.room}] wdfLeaderboard::getFormattedOnlineRankInfo()\nError fetching formatted online rank info for player ${options.pid}: ${err.message}\n${err.stack}`);
        return;
    }
};

const setCurrentSeasonDetails = async (options) => {
    if (!options.room || !options.details)
        throw new Error("Both room and details must be provided.");

    try {
        await redis.set(currentSeasonDetailsKey(options.room), JSON.stringify(options.details));
        return;
    } catch (err) {
        logger.error(`[${options.room}] wdfLeaderboard::setCurrentSeasonDetails()\nError setting current season details: ${err.message}\n${err.stack}`);
        return;
    }
};

const resetSeason = async (options) => {
    try {
        var KEYS = [
            currentSeasonDetailsKey(options.room),
            currentSeasonLbKey(options.room),
            previousSeasonLbKey(options.room),
        ];

        var ARGV = [
            options.now,
            options.nextSeasonStartTime,
            options.nextSeasonEndTime,
            options.seasonNumber
        ];

        var luaScript = `
					local currentSeason = redis.call('get', KEYS[1]);
					currentSeason = cjson.decode(currentSeason)
					local now = tonumber(ARGV[1])
					if now >= currentSeason.endTime then
						if redis.call('exists', KEYS[2]) == 1 then
							redis.call('rename', KEYS[2], KEYS[3]);
						end;
						currentSeason.startTime = tonumber(ARGV[2]);
						currentSeason.endTime = tonumber(ARGV[3]);
						currentSeason.seasonNumber = tonumber(ARGV[4]);
						currentSeason = cjson.encode(currentSeason);
						redis.call('set', KEYS[1], currentSeason);
					end;`

        await redis.eval(luaScript, { keys: KEYS, arguments: ARGV.map(String) });

        var leaderboard = await getLbPreviousSeason(options);

        for (var i = 0; i < leaderboard.length; i++) {
            var entry = leaderboard[i];

            if (!entry.dc || !entry.dc.pid) return;

            var KEYS = [
                wdfRankingKey(options.roomGameVersion),
                entry.dc.pid
            ];

            var ARGV = [
                entry.rank,
                Number.MAX_SAFE_INTEGER
            ];

            var luaScript =`local playerEntry = redis.call('hget', KEYS[1], KEYS[2]);
							if not playerEntry then
								playerEntry = ARGV[2];
							end;
							playerEntry = tonumber(playerEntry);
							local rank = tonumber(ARGV[1]);
							if rank < playerEntry then
								playerEntry = rank;
								redis.call('hset', KEYS[1], KEYS[2], playerEntry);
							end;`;

            await redis.eval(luaScript, { keys: KEYS, arguments: ARGV });
        }

        return;
    } catch (err) {
        logger.error(`[${options.room}] Error resetting season: ${err.message}\n${err.stack}`);
        return;
    }
};

const resetLeaderboard = async (options) => {
    if (!options.room) return;

    const room = options.room;

    try {
        var luaScript = `
			if redis.call('exists', KEYS[1]) == 1 then
				redis.call('del', KEYS[2], KEYS[3], KEYS[4], KEYS[1])
			end;`;

        var KEYS = [
            resetLbKey(room),
            currentSeasonDetailsKey(room),
            currentSeasonLbKey(room),
            previousSeasonLbKey(room)
        ];

        await redis.eval(luaScript, { keys: KEYS, arguments: [] });

        return;
    } catch (err) {
        logger.error(`[${room}] Error resetting leaderboard: ${err.message}\n${err.stack}`);
        return;
    }
};

const update = async (room, roomConfig) => {
    if (!room) return;

    var now = Date.now();

    if (!roomConfig) {
        logger.warn(`[${room}] wdfLeaderboard::update() - No roomConfig provided`);
        return;
    }

    var seasonDuration = roomConfig.lbSeasonDuration || wdfConfig.defaultDurations.WDF_LEADERBOARD_SEASON_DURATION;
    var firstSeasonStartTime = roomConfig.lbFirstSeasonStartTime || null;

    //logger.debug(`[${room}] wdfLeaderboard::update() - now=${now}, firstSeasonStartTime=${firstSeasonStartTime}, seasonDuration=${seasonDuration}`);

    var currentSeasonDetails = null;

    try {
        var resetKeyExists = await redis.exists(resetLbKey(room));

        try {
            resetKeyExists = parseInt(resetKeyExists);
        } catch (err) {
            throw err;
        }

        if (resetKeyExists) {
            await resetLeaderboard({ room: room });
            return;
        }

        currentSeasonDetails = await getCurrentSeasonDetails({ room: room });

        if (currentSeasonDetails && now >= currentSeasonDetails.endTime) {
            await resetSeason({
                room: room,
                now: now,
                nextSeasonStartTime: currentSeasonDetails.endTime,
                nextSeasonEndTime: currentSeasonDetails.endTime + seasonDuration,
                seasonNumber: (currentSeasonDetails.seasonNumber || 0) + 1,
                roomGameVersion: roomConfig.roomGameVersion
            });
        }

        if (!currentSeasonDetails && firstSeasonStartTime && now >= firstSeasonStartTime) {
            logger.info(`[${room}] Creating first season - startTime=${firstSeasonStartTime}, endTime=${firstSeasonStartTime + seasonDuration}`);
            await setCurrentSeasonDetails({
                room: room,
                details: {
                    seasonNumber: 1,
                    startTime: firstSeasonStartTime,
                    endTime: firstSeasonStartTime + seasonDuration
                }
            });
        }

        return;
    } catch (err) {
        logger.error(`[${room}] wdfLeaderboard::update()\nError updating leaderboard: ${err.message}\n${err.stack}`);
        return;
    }
}

const getPlayerHighestRank = async (pid, gameVersion) => {
    if (!pid || !gameVersion) return;

    try {
        const reply = await redis.hGet(wdfRankingKey(gameVersion), pid);
        return reply;
    } catch (err) {
        logger.error(`wdfLeaderboard::getPlayerHighestRank()\nError fetching highest rank for player '${pid}' in game version '${gameVersion}': ${err.message}\n${err.stack}`);
        return;
    }
};


module.exports = {
    init,
    update,
    addPointsFromScore,
    addPointsFromMapping,
    getLb,
    getLbPreviousSeason,
    getCurrentSeasonDetails,
    setCurrentSeasonDetails,
    getFormattedOnlineRankInfo,
    getCurrentSeasonLbLen,
    getPreviousSeasonLbLen,
    getPlayerHighestRank,
};