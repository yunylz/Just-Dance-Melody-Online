import { file } from "../lib/cache";
import { createLogger } from "../lib/logger";
import { client as redis } from "../lib/redis";
import { WdfClients, WdfConfig } from "../types/wdf";

const logger = createLogger({ service: "wdf/leaderboard" });
const wdfConfig = file<{ config: WdfConfig }>("/data/config.json").config as any;

let wdfSessions: any;

const unsupportedGameVersions = ["jd2017"];
const wdfPointsByScoreRange: Record<string, number> = {
    "0": 10, "1": 11, "2": 13, "3": 14, "4": 16, "5": 18, "6": 20,
    "7": 23, "8": 26, "9": 29, "10": 32, "11": 37, "12": 41, "13": 46
};

export const init = (clients: WdfClients): void => { wdfSessions = clients.wdfSessions; };

const currentSeasonDetailsKey = (room: string) => `wdf:rooms:${room}:lb:current-season-details`;
const currentSeasonLbKey      = (room: string) => `wdf:rooms:${room}:lb:current-season`;
const previousSeasonLbKey     = (room: string) => `wdf:rooms:${room}:lb:previous-season`;
const lbPlayerInfosKey        = (room: string) => `wdf:rooms:${room}:lb:player-infos`;
const resetLbKey              = (room: string) => `wdf:rooms:${room}:lb:reset`;
const wdfRankingKey           = (gameVersion: string) => `wdf:rankings:${gameVersion}`;

export const getCurrentSeasonDetails = async (options: any): Promise<any> => {
    try {
        const reply = await (redis as any).get(currentSeasonDetailsKey(options.room));
        if (!reply) return null;
        return JSON.parse(reply);
    } catch (err: any) {
        logger.error(`[${options.room}] wdfLeaderboard::getCurrentSeasonDetails()\n${err.message}\n${err.stack}`);
    }
};

export const setCurrentSeasonDetails = async (options: any): Promise<void> => {
    if (!options.room || !options.details) throw new Error("Both room and details must be provided.");
    try {
        await (redis as any).set(currentSeasonDetailsKey(options.room), JSON.stringify(options.details));
    } catch (err: any) {
        logger.error(`[${options.room}] wdfLeaderboard::setCurrentSeasonDetails()\n${err.message}\n${err.stack}`);
    }
};

const addPoints = async (options: any): Promise<void> => {
    if (!options.room || !options.pid || typeof options.points !== "number") return;
    const { room, pid, points } = options;
    try {
        const playerInfos = await wdfSessions.getPlayerInfo({ room, pids: [pid] });
        const playerInfo = { ...playerInfos[0], pid };
        const multi = (redis as any).multi();
        multi.zIncrBy(currentSeasonLbKey(room), points, pid);
        multi.hSet(lbPlayerInfosKey(room), pid, JSON.stringify(playerInfo));
        await multi.exec();
    } catch (err: any) {
        logger.error(`[${room}] wdfLeaderboard::addPoints()\n${err.message}\n${err.stack}`);
    }
};

export const addPointsFromMapping = async (options: any): Promise<void> => {
    if (unsupportedGameVersions.includes(options.roomGameVersion)) return;
    const isSeasonRunning = (details: any) => details && Date.now() > details.startTime;
    try {
        const currentSeasonDetails = await getCurrentSeasonDetails({ room: options.room });
        if (isSeasonRunning(currentSeasonDetails)) {
            const pids = Object.keys(options.pidsWithPoints);
            for (const pid of pids) {
                await addPoints({ room: options.room, pid, points: options.pidsWithPoints[pid] });
            }
        } else {
            logger.info(`[${options.room}] Season not running, skipping adding points.`);
        }
    } catch (err: any) {
        logger.error(`[${options.room}] wdfLeaderboard::addPointsFromMapping()\n${err.message}\n${err.stack}`);
    }
};

export const addPointsFromScore = async (options: any): Promise<void> => {
    if (!options.room || !options.roomGameVersion) return;
    if (unsupportedGameVersions.includes(options.roomGameVersion)) return;
    const { room, roomGameVersion } = options;

    const getPlayerScores = async (playerScoresKey: string): Promise<any[]> => {
        try {
            const reply = await (redis as any).zRangeWithScores(playerScoresKey, 0, -1, { REV: true });
            return reply.map((e: any) => ({ pid: e.value, score: parseFloat(e.score) }));
        } catch (err: any) {
            logger.error(`[${room}] leaderboard::getPlayerScores()\n${err.message}\n${err.stack}`);
            throw err;
        }
    };

    const process = async (pidsWithScores: any[]): Promise<void> => {
        const pidsWithPoints: Record<string, number> = {};
        for (const entry of pidsWithScores) {
            let score = entry.score;
            if (score < 0 || score > 1.0) { logger.warn(`[${room}] Invalid score ${score} for ${entry.pid}`); score = 0; }
            score = score * 13333;
            let pointsIndex = Math.floor(score / 1000);
            if (score % 1000 === 0) pointsIndex--;
            pidsWithPoints[entry.pid] = score > 0 ? wdfPointsByScoreRange[pointsIndex.toString()] || 0 : 0;
        }
        await addPointsFromMapping({ room, roomGameVersion, pidsWithPoints });
    };

    if (options.pidsWithScores) { await process(options.pidsWithScores); return; }
    if (!options.playerScoresKey) throw new Error("Either pidsWithScores or playerScoresKey must be provided.");

    try {
        const pidsWithScores = await getPlayerScores(options.playerScoresKey);
        await process(pidsWithScores);
    } catch (err: any) {
        logger.error(`[${room}] wdfLeaderboard::addPointsFromScore()\n${err.message}\n${err.stack}`);
    }
};

const getPlayerInfos = async (options: any): Promise<any[]> => {
    try {
        const multi = (redis as any).multi();
        for (const pid of options.pids) multi.hGet(lbPlayerInfosKey(options.room), pid);
        const playerInfos = await multi.exec();
        return playerInfos.map((info: any) => { try { return JSON.parse(info); } catch { return info; } });
    } catch (err: any) {
        logger.error(`[${options.room}] wdfLeaderboard::getPlayerInfos()\n${err.message}\n${err.stack}`);
        return [];
    }
};

const getLbLen = async (lbKey: string): Promise<number | undefined> => {
    try {
        return parseInt(await (redis as any).zCard(lbKey));
    } catch (err: any) {
        logger.error(`wdfLeaderboard::getLbLen()\n${err.message}\n${err.stack}`);
    }
};

const getLbFromKey = async (lbKey: string, options: any): Promise<any[] | undefined> => {
    if (!lbKey || !options) return;

    const getPlayerRank = async (lbLen: number): Promise<number | null> => {
        if (options.pid) {
            const rankReply = await (redis as any).zRevRank(lbKey, options.pid);
            if (rankReply === null) return null;
            const rank = parseInt(rankReply);
            return isNaN(rank) ? null : rank;
        }
        if (options.rank !== undefined) return options.rank < 0 ? lbLen + options.rank : options.rank - 1;
        return null;
    };

    try {
        const lbLen = await getLbLen(lbKey);
        const rank = await getPlayerRank(lbLen!);
        let startingRank: number;
        let pidsWithPoints: any[];

        let zStart = 0, zStop = -1;
        if (options.pid && rank === null) { startingRank = rank!; pidsWithPoints = []; }
        else if (rank !== null) {
            if ((options.above ?? 0) < 0 || (options.below ?? 0) < 0) throw new Error("above and below must be non-negative.");
            zStart = Math.max(rank! - (options.above || 0), 0);
            zStop  = rank! + (options.below || 0);
            pidsWithPoints = await (redis as any).zRangeWithScores(lbKey, zStart, zStop, { REV: true });
            startingRank = zStart + 1;
        } else {
            pidsWithPoints = await (redis as any).zRangeWithScores(lbKey, zStart, zStop, { REV: true });
            startingRank = zStart + 1;
        }

        const lb: any[] = [];
        const pids: string[] = [];
        for (const entry of pidsWithPoints) {
            pids.push(entry.value);
            lb.push({ wdfPoints: parseInt(entry.score) });
        }

        const playerInfos = await getPlayerInfos({ room: options.room, pids });
        for (let j = 0; j < lb.length; j++) { lb[j].dc = playerInfos[j]; lb[j].rank = startingRank + j; }
        return lb;
    } catch (err: any) {
        logger.error(`wdfLeaderboard::getLbFromKey()\n${err.message}\n${err.stack}`);
    }
};

export const getLb = async (options: any): Promise<any[] | undefined> => {
    if (!options.room) return;
    try { return getLbFromKey(currentSeasonLbKey(options.room), options); }
    catch (err: any) { logger.error(`[${options.room}] wdfLeaderboard::getLb()\n${err.message}\n${err.stack}`); }
};

export const getLbPreviousSeason = async (options: any): Promise<any[] | undefined> => {
    if (!options.room) return;
    try { return getLbFromKey(previousSeasonLbKey(options.room), options); }
    catch (err: any) { logger.error(`[${options.room}] wdfLeaderboard::getLbPreviousSeason()\n${err.message}\n${err.stack}`); }
};

export const getCurrentSeasonLbLen = async (options: any): Promise<number | undefined> => {
    if (!options.room) return;
    try { return getLbLen(currentSeasonLbKey(options.room)); }
    catch (err: any) { logger.error(`[${options.room}] wdfLeaderboard::getCurrentSeasonLbLen()\n${err.message}\n${err.stack}`); }
};

export const getPreviousSeasonLbLen = async (options: any): Promise<number | undefined> => {
    if (!options.room) return;
    try { return getLbLen(previousSeasonLbKey(options.room)); }
    catch (err: any) { logger.error(`[${options.room}] wdfLeaderboard::getPreviousSeasonLbLen()\n${err.message}\n${err.stack}`); }
};

export const getFormattedOnlineRankInfo = async (options: any): Promise<any> => {
    try {
        const lb = await getLb({ room: options.room, pid: options.pid });
        if (lb?.[0]) return { __class: "WDFOnlineRankInfo", rank: lb[0].rank, wdfPoints: lb[0].wdfPoints };
        return {};
    } catch (err: any) {
        logger.error(`[${options.room}] wdfLeaderboard::getFormattedOnlineRankInfo()\n${err.message}\n${err.stack}`);
    }
};

const resetSeason = async (options: any): Promise<void> => {
    try {
        const KEYS = [currentSeasonDetailsKey(options.room), currentSeasonLbKey(options.room), previousSeasonLbKey(options.room)];
        const ARGV = [options.now, options.nextSeasonStartTime, options.nextSeasonEndTime, options.seasonNumber];
        const luaScript = `
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
            end;`;
        await (redis as any).eval(luaScript, { keys: KEYS, arguments: ARGV.map(String) });

        const leaderboard = await getLbPreviousSeason(options) ?? [];
        for (const entry of leaderboard) {
            if (!entry.dc?.pid) return;
            const rankKeys = [wdfRankingKey(options.roomGameVersion), entry.dc.pid];
            const rankArgs = [entry.rank, Number.MAX_SAFE_INTEGER];
            const rankScript = `local playerEntry = redis.call('hget', KEYS[1], KEYS[2]);
                if not playerEntry then playerEntry = ARGV[2]; end;
                playerEntry = tonumber(playerEntry);
                local rank = tonumber(ARGV[1]);
                if rank < playerEntry then
                    playerEntry = rank;
                    redis.call('hset', KEYS[1], KEYS[2], playerEntry);
                end;`;
            await (redis as any).eval(rankScript, { keys: rankKeys, arguments: rankArgs });
        }
    } catch (err: any) {
        logger.error(`[${options.room}] Error resetting season: ${err.message}\n${err.stack}`);
    }
};

const resetLeaderboard = async (options: any): Promise<void> => {
    if (!options.room) return;
    const room = options.room;
    try {
        const luaScript = `
            if redis.call('exists', KEYS[1]) == 1 then
                redis.call('del', KEYS[2], KEYS[3], KEYS[4], KEYS[1])
            end;`;
        const KEYS = [resetLbKey(room), currentSeasonDetailsKey(room), currentSeasonLbKey(room), previousSeasonLbKey(room)];
        await (redis as any).eval(luaScript, { keys: KEYS, arguments: [] });
    } catch (err: any) {
        logger.error(`[${room}] Error resetting leaderboard: ${err.message}\n${err.stack}`);
    }
};

export const update = async (room: string, roomConfig: any): Promise<void> => {
    if (!room) return;
    const now = Date.now();
    if (!roomConfig) { logger.warn(`[${room}] wdfLeaderboard::update() - No roomConfig provided`); return; }

    const seasonDuration = roomConfig.lbSeasonDuration || wdfConfig.defaultDurations.WDF_LEADERBOARD_SEASON_DURATION;
    const firstSeasonStartTime = roomConfig.lbFirstSeasonStartTime || null;

    try {
        let resetKeyExists = parseInt(await (redis as any).exists(resetLbKey(room)));
        if (resetKeyExists) { await resetLeaderboard({ room }); return; }

        let currentSeasonDetails = await getCurrentSeasonDetails({ room });
        if (currentSeasonDetails && now >= currentSeasonDetails.endTime) {
            await resetSeason({ room, now, nextSeasonStartTime: currentSeasonDetails.endTime, nextSeasonEndTime: currentSeasonDetails.endTime + seasonDuration, seasonNumber: (currentSeasonDetails.seasonNumber || 0) + 1, roomGameVersion: roomConfig.roomGameVersion });
        }
        if (!currentSeasonDetails && firstSeasonStartTime && now >= firstSeasonStartTime) {
            logger.info(`[${room}] Creating first season`);
            await setCurrentSeasonDetails({ room, details: { seasonNumber: 1, startTime: firstSeasonStartTime, endTime: firstSeasonStartTime + seasonDuration } });
        }
    } catch (err: any) {
        logger.error(`[${room}] wdfLeaderboard::update()\n${err.message}\n${err.stack}`);
    }
};

export const getPlayerHighestRank = async (pid: string, gameVersion: string): Promise<any> => {
    if (!pid || !gameVersion) return;
    try { return (redis as any).hGet(wdfRankingKey(gameVersion), pid); }
    catch (err: any) { logger.error(`wdfLeaderboard::getPlayerHighestRank()\n${err.message}\n${err.stack}`); }
};
