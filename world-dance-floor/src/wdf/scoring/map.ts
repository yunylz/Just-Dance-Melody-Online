import { createLogger } from "../../lib/logger";
import { client as redis } from "../../lib/redis";
import { WdfClients } from "../../types/wdf";

const logger = createLogger({ service: "wdf/scoring/map" });

let wdfSessions: any;
let wdfLeaderboard: any;

const playerScoresKey = (room: string) => `wdf:rooms:${room}:player-scores`;
const recapKey       = (room: string) => `wdf:rooms:${room}:score-recap`;
const recapComputedKey = (room: string) => `wdf:rooms:${room}:recap-computed`;

export const init = (clients: WdfClients): void => {
    wdfSessions  = clients.wdfSessions;
    wdfLeaderboard = clients.wdfLeaderboard;
};

export const cleanUp = async (options: any): Promise<void> => {
    if (!options.room) return;
    const room: string = options.room;
    try {
        const multi = redis.multi();
        multi.del(playerScoresKey(room));
        multi.del(recapKey(room));
        multi.del(recapComputedKey(room));
        multi.exec();
    } catch (err: any) {
        logger.error(`[${room}] Error cleaning up room: ${err.message}\n${err.stack}`);
    }
};

export const getPlayerScores = async (options: any): Promise<any[] | undefined> => {
    if (!options.room) return;
    const room: string = options.room;
    try {
        const reply = await redis.zRangeWithScores(playerScoresKey(room), 0, -1, { REV: true });
        return reply.map(e => ({ pid: e.value, score: e.score }));
    } catch (err: any) {
        logger.error(`[${room}] Error fetching player scores: ${err.message}\n${err.stack}`);
    }
};

export const computeRecap = async (options: any): Promise<void> => {
    if (!options.room) return;
    const room: string = options.room;
    try {
        await wdfLeaderboard.addPointsFromScore({
            room,
            playerScoresKey: playerScoresKey(room),
            roomGameVersion: options.state.roomGameVersion
        });

        await redis.sendCommand(["ZUNIONSTORE", recapKey(room), "1", playerScoresKey(room)]);
        await redis.del(playerScoresKey(room));
        await redis.set(recapComputedKey(room), "true");
    } catch (err: any) {
        logger.error(`[${room}] Error computing recap: ${err.message}\n${err.stack}`);
    }
};

export const resetComputeRecap = async (options: any): Promise<void> => {
    if (!options.room) return;
    const room: string = options.room;
    try {
        const multi = redis.multi();
        multi.del(recapComputedKey(room));
        multi.del(recapKey(room));
        await multi.exec();
    } catch (err: any) {
        logger.error(`[${room}] Error resetting compute recap: ${err.message}\n${err.stack}`);
    }
};

const createScoreObject = async (options: any): Promise<any> => {
    const pids: string[] = [];
    const pidsWithScores: any[] = options.pidsWithScores || options.playerScores;

    for (let i = 0; i < pidsWithScores.length; i += 2) {
        if (pidsWithScores[i] !== "") pids.push(pidsWithScores[i]);
    }

    try {
        const dancerCardInfos = await wdfSessions.getPlayerInfo({ room: options.room, pids });

        const scores: any[] = [];
        for (let i = 0; i < dancerCardInfos.length; i++) {
            const scoreObject: any = dancerCardInfos[i];
            scoreObject.__class = options.returnEntry;
            scoreObject.score  = parseFloat(pidsWithScores[i * 2 + 1]);
            scoreObject.pid    = pidsWithScores[i * 2];
            scores.push(scoreObject);
        }

        const scoreInfos: any = { __class: options.returnContainer };
        scoreInfos[options.rank]          = options.currentRank;
        scoreInfos[options.scoreContainer] = scores;
        if (options.totalPlayers) scoreInfos[options.totalPlayers] = options.playerCount;

        return scoreInfos;
    } catch (err: any) {
        logger.error(`[${options.room}] Error creating score object: ${err.message}\n${err.stack}`);
    }
};

const getScoreInfo = async (options: any): Promise<any> => {
    if (!options.room) return;
    const room: string = options.room;

    const luaScript = `
        local newRank = redis.call('zrevrank', KEYS[1], ARGV[1]);
        if newRank == false then newRank = -1; end;
        local lowerLimit;
        lowerLimit = newRank <= 4 and 0 or newRank - 4;
        return {newRank ,redis.call('zrevrange', KEYS[1], lowerLimit, newRank + 4, 'WITHSCORES')}`;

    try {
        const value: any = await redis.eval(luaScript, { keys: [options.key], arguments: [options.pid] });
        value[0] = parseInt(value[0]) + 1;
        const pidsWithScores: any[] = value[1] || [];
        return await createScoreObject({ ...options, pidsWithScores, currentRank: value[0], rank: "currentRank" });
    } catch (err: any) {
        logger.error(`[${room}] Error fetching score info: ${err.message}\n${err.stack}`);
    }
};

export const updateScore = async (options: any): Promise<any> => {
    if (!options.room) return;
    const room: string = options.room;
    try {
        const multi = redis.multi();
        multi.zAdd(playerScoresKey(room), { score: options.score.score, value: options.pid });
        await multi.exec();

        return getScoreInfo({
            room,
            key: playerScoresKey(room),
            pid: options.pid,
            returnEntry: "MapEntry",
            returnContainer: "UpdatedScore",
            scoreContainer: "scoringMap",
            totalPlayers: "totalPlayers",
            playerCount: options.playerCount,
        });
    } catch (err: any) {
        logger.error(`[${room}] Error updating score: ${err.message}\n${err.stack}`);
    }
};

export const getRecap = async (options: any): Promise<any> => {
    if (!options.room) return;
    const room: string = options.room;
    try {
        const recapComputed = await redis.get(recapComputedKey(room));
        if (recapComputed !== "true") return { __class: "RecapInfo", recapComputed: false };

        const data = await redis.get(recapKey(room));
        if (!data) return { __class: "RecapInfo", recapComputed: false };

        return getScoreInfo({
            room,
            key: recapKey(room),
            pid: options.pid,
            returnEntry: "MapEntry",
            returnContainer: "RecapInfo",
            scoreContainer: "scoringMap",
            totalPlayers: "totalPlayers",
            playerCount: options.playerCount,
        });
    } catch (err: any) {
        logger.error(`[${room}] Error getting recap: ${err.message}\n${err.stack}`);
    }
};

export const getScoreStatus = async (options: any): Promise<any> => {
    if (!options.room) return;
    const room: string = options.room;
    try {
        const score = await redis.zScore(playerScoresKey(room), options.pid);
        return {
            __class: "ScoreStatus",
            score: score !== null ? parseFloat(score as any) : 0,
        };
    } catch (err: any) {
        logger.error(`[${room}] Error getting score status: ${err.message}\n${err.stack}`);
    }
};
