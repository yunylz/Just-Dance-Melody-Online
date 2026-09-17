import { client as redis } from "../lib/redis";
import { createLogger } from "../lib/logger";
import { WdfClients } from "../types/wdf";

const logger = createLogger({ service: "wdf/sessions" });

let wdfLeaderboard: any;

const weeklyTournamentWinnersKey = "wdf:weekly-tournament-winners";

const getWeeklyTournamentWinners = async (): Promise<string[]> => {
    try { (redis as any).zRemRangeByScore(weeklyTournamentWinnersKey, "-inf", Date.now() / 1000); } catch (err: any) { logger.error("Error cleaning up weekly tournament winners:", err); }
    try { return await (redis as any).zRange(weeklyTournamentWinnersKey, 0, -1); }
    catch (err: any) { logger.error("Error fetching weekly tournament winners:", err); return []; }
};

export const getPlayerInfo = async (options: any): Promise<any[] | undefined> => {
    if (!options.room || !options.pids) return;
    const tournamentWinners = await getWeeklyTournamentWinners();
    try {
        const multi = (redis as any).multi();
        for (const pid of options.pids) multi.get(`wdf:rooms:${options.room}:players-session-info:${pid}`);
        const reply = await multi.exec();

        const multi2 = (redis as any).multi();
        const dancerCardInfos: any[] = [];

        for (let i = 0; i < reply.length; i++) {
            if (reply[i] === null) throw new Error(`No session info found for pid ${options.pids[i]} in room ${options.room}`);
            const dancerCardInfo = JSON.parse(reply[i]);
            dancerCardInfo.tournamentBadge = tournamentWinners.indexOf(options.pids[i]) !== -1;
            dancerCardInfo.nameSuffix = 0;
            dancerCardInfos.push(dancerCardInfo);
            multi.hLen(`wdf:rooms:${options.room}:player-names:${dancerCardInfo.name}`);
            multi.hGet(`wdf:rooms:${options.room}:player-names:${dancerCardInfo.name}`, options.pids[i]);
        }
        await multi2.exec();
        return dancerCardInfos;
    } catch (err: any) {
        logger.error(`[${options.room}] Error getting player info: ${err.message}\n${err.stack}`);
    }
};

export const getPlayers = async (options: any): Promise<string[] | undefined> => {
    if (!options.room) return;
    try {
        return await (redis as any).zRangeByScore(`wdf:rooms:${options.room}:player-session-expiry`, "(" + (Date.now() / 1000), "+inf");
    } catch (err: any) {
        logger.error(`[${options.room}] Error fetching players: ${err.message}\n${err.stack}`);
    }
};

export const getCountryCounts = async (options: any): Promise<Record<string, number> | undefined> => {
    if (!options.room) return;
    try {
        const players = await getPlayers({ room: options.room });
        const dancerCardInfos = await getPlayerInfo({ room: options.room, pids: players });
        const countryCounts: Record<string, number> = {};
        dancerCardInfos?.forEach((info) => { countryCounts[info.country] = (countryCounts[info.country] || 0) + 1; });
        return countryCounts;
    } catch (err: any) {
        logger.error(`[${options.room}] Error fetching country counts: ${err.message}\n${err.stack}`);
    }
};

export const getNumberOfPlayers = async (options: any): Promise<number | undefined> => {
    if (!options.room) return;
    try {
        return parseInt(await (redis as any).zCount(`wdf:rooms:${options.room}:player-session-expiry`, "(" + (Date.now() / 1000), "+inf"));
    } catch (err: any) {
        logger.error(`[${options.room}] Error fetching number of players: ${err.message}\n${err.stack}`);
    }
};

export const joinSession = async (options: any): Promise<any> => {
    if (!options.room || !options.pid || !options.profile || !options.platform) return;
    try {
        const ccu = await getNumberOfPlayers({ room: options.room });
        const playerInfo = { ...options.profile, isSubscribed: true, platform: options.platform };

        const luaScript = `redis.call('set', KEYS[1], ARGV[1]);
            redis.call('zadd', KEYS[2], ARGV[2], ARGV[3]);
            if redis.call('hexists', KEYS[3], ARGV[3]) == 1 then return nil; end;
            local values = redis.call('hgetall', KEYS[3]);
            local index = 1;
            if ARGV[5] == 'x1' then index = 0;
            else for i=1,#values,2 do if index == tonumber(values[i+1]) then index = index + 1; end; end; end;
            redis.call('hset', KEYS[3], ARGV[3], index);
            redis.call('zadd', KEYS[4], ARGV[4], ARGV[3]);
            redis.call('hset', KEYS[5], ARGV[3], ARGV[6]);
            redis.call('hincrby', KEYS[6], ARGV[7], 1);`;

        const result = await (redis as any).eval(luaScript, {
            keys: [
                `wdf:rooms:${options.room}:players-session-info:${options.pid}`,
                `wdf:rooms:${options.room}:player-session-expiry`,
                `wdf:rooms:${options.room}:player-names:${playerInfo.name}`,
                `wdf:rooms:${options.room}:session-join-times`,
                `wdf:rooms:${options.room}:players-met-count`,
                `wdf:rooms:${options.room}:player-count-per-country`
            ],
            arguments: [
                JSON.stringify(playerInfo),
                String((Date.now() / 1000) + 300),
                options.pid,
                String(Date.now() / 1000),
                options.platform,
                (ccu !== undefined && !isNaN(ccu)) ? String(ccu) : "0",
                playerInfo.country ? String(playerInfo.country) : "Unknown"
            ]
        });
        return result;
    } catch (err: any) {
        logger.error(`[${options.room}] Error joining session for pid ${options.pid}: ${err.message}\n${err.stack}`);
    }
};

export const leaveSession = async (options: any): Promise<void> => {
    if (!options.room || !options.pid) return;
    try {
        await (redis as any).zAdd(`wdf:rooms:${options.room}:player-session-expiry`, { score: Date.now() / 1000, value: options.pid });
    } catch (err: any) {
        logger.error(`[${options.room}] Error leaving session for pid ${options.pid}: ${err.message}\n${err.stack}`);
    }
};

export const update = async (options: any): Promise<void> => {
    if (!options.room) return;
    const room = options.room;
    try {
        const multi = (redis as any).multi();
        multi.zCount(`wdf:rooms:${room}:player-session-expiry`, "(" + (Date.now() / 1000), "+inf");
        multi.get(`wdf:rooms:${room}:concurrency-stats`);
        const reply = await multi.exec();
        const numPlayers = parseInt(reply[0]) || 0;
        let concurrencyStats: any = reply[1] ? JSON.parse(reply[1]) : { maxPlayers: numPlayers, minPlayers: numPlayers };
        let setRedis = !reply[1];
        if (numPlayers < concurrencyStats.minPlayers) { concurrencyStats.minPlayers = numPlayers; setRedis = true; }
        if (numPlayers > concurrencyStats.maxPlayers) { concurrencyStats.maxPlayers = numPlayers; setRedis = true; }
        if (setRedis) await (redis as any).set(`wdf:rooms:${room}:concurrency-stats`, JSON.stringify(concurrencyStats));
    } catch (err: any) {
        logger.error(`[${room}] Error updating session info: ${err.message}\n${err.stack}`);
    }
};

export const clean = async (options: any): Promise<void> => {
    if (!options.room) return;
    const room = options.room;
    const now = Date.now() / 1000;
    try {
        const expiredPlayers = await (redis as any).zRangeByScore(`wdf:rooms:${room}:player-session-expiry`, "-inf", String(now));
        const dancerCardInfos = await getPlayerInfo({ room, pids: expiredPlayers }) ?? [];
        const multi = (redis as any).multi();
        for (let i = 0; i < expiredPlayers.length; i++) {
            multi.del(`wdf:rooms:${room}:player-session-info:${expiredPlayers[i]}`);
            multi.zRem(`wdf:rooms:${room}:player-session-expiry`, expiredPlayers[i]);
            multi.hDel(`wdf:rooms:${room}:player-names:${dancerCardInfos[i]?.name}`, expiredPlayers[i]);
            multi.hIncrBy(`wdf:rooms:${room}:player-count-per-country`, String(dancerCardInfos[i]?.country), -1);
            multi.del(`wdf:rooms:${room}:concurrency-stats`);
        }
        await multi.exec();

        const deleteSessionInfoTime = now - 8 * 60 * 60;
        const expiredSessionInfos = await (redis as any).zRangeByScore(`wdf:rooms:${room}:session-join-times`, "-inf", String(deleteSessionInfoTime));
        const multi2 = (redis as any).multi();
        for (const pid of expiredSessionInfos) multi2.hDel(`wdf:rooms:${room}:players-met-count`, pid);
        multi2.zRemRangeByScore(`wdf:rooms:${room}:session-join-times`, "-inf", String(deleteSessionInfoTime));
        await multi2.exec();
    } catch (err: any) {
        logger.error(`[${room}] Error cleaning sessions: ${err.message}\n${err.stack}`);
    }
};

export const getSessionInfo = async (options: any): Promise<any | undefined> => {
    if (!options.room || !options.pid) return;
    const room = options.room;
    const now = Date.now() / 1000;
    try {
        let playerCountPerCountry = await (redis as any).hGetAll(`wdf:rooms:${room}:player-count-per-country`) ?? {};
        const multi = (redis as any).multi();
        multi.zScore(`wdf:rooms:${room}:session-join-times`, options.pid);
        multi.hGet(`wdf:rooms:${room}:players-met-count`, options.pid);
        const replies = await multi.exec();
        const joinTime = replies[0] ? parseFloat(replies[0]) : Infinity;
        const countAtJoining = replies[1] ? parseInt(replies[1]) : 0;
        const countAfterJoined = await (redis as any).zCount(`wdf:rooms:${room}:session-join-times`, joinTime, now);
        const uniqueCount = parseInt(countAfterJoined) + countAtJoining;
        const countriesMet = Object.keys(playerCountPerCountry).filter((c) => playerCountPerCountry[c] > 0);

        const sessionInfo: any = { uniquePlayerCount: uniqueCount, countries: countriesMet };
        const lb = await wdfLeaderboard.getLb({ room, pid: options.pid, above: 4, below: 4 });
        for (let i = lb.length - 1; i >= 0; i--) { lb[i].__class = "WDFOnlineRankInfo"; lb[i].dc.__class = "ScoreEntry"; }
        sessionInfo.lb = lb;
        return sessionInfo;
    } catch (err: any) {
        logger.error(`[${room}] Error getting session info for pid ${options.pid}: ${err.message}\n${err.stack}`);
    }
};

export const init = (clients: WdfClients): void => { wdfLeaderboard = clients.wdfLeaderboard; };
