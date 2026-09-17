/**
 * 
 */

// External modules

// Internal modules
const redis = require("../lib/redis").client;
const logger = require("../lib/logger").createLogger({ service: "wdf/sessions" });

// WDF modules
var wdfLeaderboard;

var weeklyTournamentWinnersKey = "wdf:weekly-tournament-winners";


const getWeeklyTournamentWinners = async () => {
    try {
        redis.zRemRangeByScore(weeklyTournamentWinnersKey, "-inf", (Date.now() / 1000));
    } catch (err) {
        logger.error("Error cleaning up weekly tournament winners:", err);
    }

    try {
        var data = redis.zRange(weeklyTournamentWinnersKey, 0, -1);
        return data;
    } catch (err) {
        logger.error("Error fetching weekly tournament winners:", err);
        return [];
    }
};

const getPlayerInfo = async (options) => {
    if (!options.room || !options.pids) return;

    var tournamentWinners = await getWeeklyTournamentWinners();
    
    var dancerCardInfos;
    try {
        var multi = redis.multi();

        for (var i = 0; i < options.pids.length; i++) {
            multi.get(`wdf:rooms:${options.room}:players-session-info:${options.pids[i]}`);
        }

        const reply = await multi.exec();

        var multi2 = redis.multi();

        dancerCardInfos = [];

        for (var i = 0; i < reply.length; i++) {
            if (reply[i] === null) {
                throw new Error(`No session info found for pid ${options.pids[i]} in room ${options.room}`);
            }

            var dancerCardInfo;

            try {
                dancerCardInfo = JSON.parse(reply[i]);
                dancerCardInfo.tournamentBadge = (tournamentWinners.indexOf(options.pids[i]) !== -1);
                dancerCardInfo.nameSuffix = 0;
                dancerCardInfos.push(dancerCardInfo);
            } catch (err) {
                throw err;
            }

            multi.hLen(`wdf:rooms:${options.room}:player-names:${dancerCardInfo.name}`);
            multi.hGet(`wdf:rooms:${options.room}:player-names:${dancerCardInfo.name}`, options.pids[i]);
        }

        const reply2 = await multi2.exec();

        return dancerCardInfos;
    }
    catch (err) {
        logger.error(`[${options.room}] Error getting player info: ${err.message}\n${err.stack}`);
        return;
    }
};

const getPlayers = async (options) => {
    if (!options.room) return;

    const room = options.room;

    try {
        const players = await redis.zRangeByScore(`wdf:rooms:${room}:player-session-expiry`, "(" + (Date.now() / 1000), "+inf");

        return players;
    } catch (err) {
        logger.error(`[${room}] Error fetching players: ${err.message}\n${err.stack}`);
        return;
    }
};

const getCountryCounts = async (options) => {
    if (!options.room) return;

    const room = options.room;

    try {
        const players = await getPlayers({ room: room });

        const dancerCardInfos = await getPlayerInfo({ room: room, pids: players });

        var countryCounts = {};

        dancerCardInfos.forEach((info) => {
            countryCounts[info.country] = ++countryCounts[info.country] || 1;
        });

        return countryCounts;
    } catch (err) {
        logger.error(`[${room}] Error fetching country counts: ${err.message}\n${err.stack}`);
        return;
    }
};

const getNumberOfPlayers = async (options) => {
    if (!options.room) return;

    const room = options.room;

    try {
        var numPlayers = await redis.zCount(`wdf:rooms:${room}:player-session-expiry`, "(" + (Date.now() / 1000), "+inf");

        numPlayers = parseInt(numPlayers);

        return numPlayers;
    } catch (err) {
        logger.error(`[${room}] Error fetching number of players: ${err.message}\n${err.stack}`);
        return;
    }
};

// TODO: implement MongoDB
const getPlayerInfoMongo = async (options) => {};

/**
 * room, pid, profile, platform
 * @param {*} options 
 * @returns 
 */
const joinSession = async (options) => {
    if (!options.room || !options.pid || !options.profile || !options.platform) return;

    var ccu;

    try {
        ccu = await getNumberOfPlayers({ room: options.room });

        // store dancercard info and expiry in redis
        var playerInfo = options.profile;
        playerInfo.isSubscribed = true;
        playerInfo.platform = options.platform;

        var luaScript = `redis.call('set', KEYS[1], ARGV[1]);
                        redis.call('zadd', KEYS[2], ARGV[2], ARGV[3]);
                        if redis.call('hexists', KEYS[3], ARGV[3]) == 1 then
							return nil;
						end;
						local values = redis.call('hgetall', KEYS[3]);
						local index = 1;
						if ARGV[5] == 'x1' then
							index = 0;
						else
						for i=1,#values,2 do
							if index == tonumber(values[i+1]) then
								index = index + 1;
								end;
							end;
						end;
						redis.call('hset', KEYS[3], ARGV[3], index);
						redis.call('zadd', KEYS[4], ARGV[4], ARGV[3]);
						redis.call('hset', KEYS[5], ARGV[3], ARGV[6]);
						redis.call('hincrby', KEYS[6], ARGV[7], 1);`;

        var key1 = `wdf:rooms:${options.room}:players-session-info:${options.pid}`;
        var key2 = `wdf:rooms:${options.room}:player-session-expiry`;
        var key3 = `wdf:rooms:${options.room}:player-names:${playerInfo.name}`;
        var key4 = `wdf:rooms:${options.room}:session-join-times`;
        var key5 = `wdf:rooms:${options.room}:players-met-count`;
        var key6 = `wdf:rooms:${options.room}:player-count-per-country`;

        var argv1 = JSON.stringify(playerInfo);
        var argv2 = String((Date.now() / 1000) + 300); // 5 minutes from now
        var argv3 = options.pid;
        var argv4 = String(Date.now() / 1000);
        var argv5 = options.platform;
        var argv6 = (ccu !== undefined && ccu !== null && !isNaN(ccu)) ? String(ccu) : '0';
        var argv7 = playerInfo.country ? String(playerInfo.country) : 'Unknown';

        const result = await redis.eval(luaScript, { keys: [key1, key2, key3, key4, key5, key6], arguments: [argv1, argv2, argv3, argv4, argv5, argv6, argv7] });

        return result;
    } catch (err) {
        logger.error(`[${options.room}] Error joining session for pid ${options.pid}: ${err.message}\n${err.stack}`);
        return;
    }
};

const leaveSession = async (options) => {
    if (!options.room || !options.pid) return;

    const room = options.room;

    try {
        await redis.zAdd(`wdf:rooms:${room}:player-session-expiry`, { score: (Date.now() / 1000), value: options.pid });
        
        return;
    } catch (err) {
        logger.error(`[${room}] Error leaving session for pid ${options.pid}: ${err.message}\n${err.stack}`);
        return;
    }
};

const update = async (options) => {
    if (!options.room) return;

    const room = options.room;

    try {
        var multi = redis.multi();

        multi.zCount(`wdf:rooms:${room}:player-session-expiry`, "(" + (Date.now() / 1000), "+inf");
        multi.get(`wdf:rooms:${room}:concurrency-stats`);

        const reply = await multi.exec();

        var numPlayers, concurrencyStats;
        var setRedis = false;

        try {
            numPlayers = parseInt(reply[0]) || 0;

            if (reply[1]) {
                concurrencyStats = JSON.parse(reply[1]);
            } else {
                concurrencyStats = {
                    maxPlayers: numPlayers,
                    minPlayers: numPlayers,
                };
                setRedis = true;
            }
        } catch (err) {
            throw err;
        }

        if (numPlayers < concurrencyStats.minPlayers) {
            concurrencyStats.minPlayers = numPlayers;
            setRedis = true;
        }

        if (numPlayers > concurrencyStats.maxPlayers) {
            concurrencyStats.maxPlayers = numPlayers;
            setRedis = true;
        }

        if (setRedis) {
            await redis.set(`wdf:rooms:${room}:concurrency-stats`, JSON.stringify(concurrencyStats));
        }

        return;
    } catch (err) {
        logger.error(`[${room}] Error updating session info: ${err.message}\n${err.stack}`);
        return;
    };
};

const clean = async (options) => {
    if (!options.room) return;

    const room = options.room;

    var now = (Date.now() / 1000);

    try {
        const expiredPlayers = await redis.zRangeByScore(`wdf:rooms:${room}:player-session-expiry`, "-inf", String(now));

        const dancerCardInfos = await getPlayerInfo({ room: room, pids: expiredPlayers });

        var multi = redis.multi();

        for (var i = 0; i < expiredPlayers.length; i++) {
            multi.del("wdf:rooms:" + options.room + ":player-session-info:" + expiredPlayers[i]);
			multi.zRem("wdf:rooms:" + options.room + ":player-session-expiry", expiredPlayers[i]);
			multi.hDel("wdf:rooms:" + options.room + ":player-names:" + dancerCardInfos[i].name, expiredPlayers[i]);
			multi.hIncrBy("wdf:rooms:" + options.room + ":player-count-per-country", String(dancerCardInfos[i].country), -1);
			multi.del("wdf:rooms:" + options.room + ":concurrency-stats"); // force recalculation on next update
        }

        await multi.exec();

        var deleteSessionInfoTime = now - (8 * 60 * 60); // 8 hours

        var multi2 = redis.multi();

        var expiredSessionInfos = await redis.zRangeByScore(`wdf:rooms:${room}:session-join-times`, "-inf", String(deleteSessionInfoTime));

        for (var i = 0; i < expiredSessionInfos.length; i++) {
            multi2.hDel("wdf:rooms:" + options.room + ":players-met-count", expiredSessionInfos[i]);
        }

        multi2.zRemRangeByScore(`wdf:rooms:${room}:session-join-times`, "-inf", String(deleteSessionInfoTime));

        await multi2.exec();

        return;
    } catch (err) {
        logger.error(`[${room}] Error cleaning sessions: ${err.message}\n${err.stack}`);
        return;
    }
};

const getSessionInfo = async (options) => {
    if (!options.room || !options.pid) return;

    const room = options.room;

    var now = (Date.now() / 1000);

    try {
        var playerCountPerCountry = await redis.hGetAll(`wdf:rooms:${room}:player-count-per-country`);

        if (!playerCountPerCountry) {
            playerCountPerCountry = {};
        }

        var multi = redis.multi();

        multi.zScore(`wdf:rooms:${room}:session-join-times`, options.pid);
        multi.hGet(`wdf:rooms:${room}:players-met-count`, options.pid);

        const replies = await multi.exec();

        var joinTime, countAtJoining;

        try {
            joinTime = replies[0] ? parseFloat(replies[0]) : "+inf";
            countAtJoining = replies[1] ? parseInt(replies[1]) : 0;
        } catch (err) {
            throw err;
        }

        var countAfterJoined = await redis.zCount(`wdf:rooms:${room}:session-join-times`, joinTime, now);

        var uniqueCount = 0;

        try {
            uniqueCount = parseInt(countAfterJoined) + parseInt(countAtJoining);
        } catch (err) {
            throw err;
        }

        var countries = Object.keys(playerCountPerCountry);
        var countriesMet = countries.filter((country) => {
            return playerCountPerCountry[country] > 0;
        });

        var sessionInfo = {
            uniquePlayerCount: uniqueCount,
            countries: countriesMet,
        };

        var lb = await wdfLeaderboard.getLb({
            room: room,
            pid: options.pid,
            above: 4,
            below: 4
        });

        for (var i = lb.length - 1; i >= 0; i--) {
            lb[i].__class = "WDFOnlineRankInfo";
            lb[i].dc.__class = "ScoreEntry";
        }

        sessionInfo.lb = lb;

        return sessionInfo;
    } catch (err) {
        logger.error(`[${room}] Error getting session info for pid ${options.pid}: ${err.message}\n${err.stack}`);
        return;
    }
};

const init = (clients) => {
    wdfLeaderboard = clients.wdfLeaderboard;

    return;
};


module.exports = {
    getPlayerInfo,
    getPlayers,
    getCountryCounts,
    getNumberOfPlayers,
    joinSession,
    leaveSession,
    update,
    clean,
    getSessionInfo,
    init,
};