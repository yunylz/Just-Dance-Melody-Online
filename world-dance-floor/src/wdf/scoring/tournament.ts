import { file } from "../../lib/cache";
import { createLogger } from "../../lib/logger";
import { client as redis } from "../../lib/redis";
import { WdfClients, WdfConfig } from "../../types/wdf";

const logger = createLogger({ service: "wdf/scoring/tournament" });
const wdfConfig = file<{ config: WdfConfig }>("/data/config.json").config as any;

let wdfSessions: any;
let wdfLeaderboard: any;

const keys = {
    playerScores:           (room: string) => `wdf:rooms:${room}:player-scores`,
    recap:                  (room: string) => `wdf:rooms:${room}:score-recap`,
    tournamentRecap:        (room: string) => `wdf:rooms:${room}:tournament-recap`,
    recapComputed:          (room: string) => `wdf:rooms:${room}:recap-computed`,
    tournamentType:         (room: string) => `wdf:rooms:${room}:tournament-type`,
    eswcTournamentPlayerData:(room: string) => `wdf:rooms:${room}:eswcTournamentPlayerData`,
};

export const init = (clients: WdfClients): void => {
    wdfSessions    = clients.wdfSessions;
    wdfLeaderboard = clients.wdfLeaderboard;
};

export const start = async (options: any): Promise<void> => {
    try {
        await redis.set(keys.tournamentType(options.room), options.state.tournamentType);
    } catch (err: any) {
        logger.error(`[${options.room}] wdfScoring::tournament::start()\nFailed: ${err.message}`);
        throw err;
    }
};

export const cleanUp = async (options: any): Promise<void> => {
    if (!options.room) throw new Error("No room provided");
    try {
        const multi = redis.multi();
        multi.del(keys.playerScores(options.room));
        multi.del(keys.tournamentRecap(options.room));
        multi.del(keys.recap(options.room));
        multi.del(keys.recapComputed(options.room));
        multi.del(keys.tournamentType(options.room));
        multi.del(keys.eswcTournamentPlayerData(options.room));
        await multi.exec();
    } catch (err: any) {
        logger.error(`[${options.room}] wdfScoring::tournament::cleanUp()\nFailed: ${err.message}`);
        throw err;
    }
};

export const computeRecap = async (options: any): Promise<void> => {
    if (!options.room) throw new Error("Room parameter is required for computeRecap");

    try {
        await wdfLeaderboard.addPointsFromScore({
            room: options.room,
            playerScoresKey: keys.playerScores(options.room),
            roomGameVersion: options.state.roomGameVersion
        });
    } catch (err: any) {
        logger.error(`[${options.room}] wdfScoring::tournament::computeRecap()\nFailed addPointsFromScore: ${err.message}`);
        throw err;
    }

    try {
        await redis.zUnionStore(keys.recap(options.room), [keys.playerScores(options.room)]);
        await redis.zUnionStore(keys.tournamentRecap(options.room), [keys.tournamentRecap(options.room), keys.recap(options.room)], { AGGREGATE: "SUM" });
        await redis.set(keys.recapComputed(options.room), "true");
    } catch (err: any) {
        logger.error(`[${options.room}] wdfScoring::tournament::computeRecap()\nFailed multi: ${err.message}`);
        throw err;
    }

    try {
        if (options.state.currentRound === options.state.playlistLength) {
            const pids = (await redis.zRange(keys.tournamentRecap(options.room), 0, 2, { REV: true })).map(String);
            const pidsWithPoints: Record<string, number> = {};
            if (pids[0]) pidsWithPoints[pids[0]] = 40 * options.state.playlistLength;
            if (pids[1]) pidsWithPoints[pids[1]] = 25 * options.state.playlistLength;
            if (pids[2]) pidsWithPoints[pids[2]] = 15 * options.state.playlistLength;

            await wdfLeaderboard.addPointsFromMapping({
                room: options.room,
                pidsWithPoints,
                roomGameVersion: options.state.roomGameVersion
            });
        }
    } catch (err: any) {
        logger.error(`[${options.room}] wdfScoring::tournament::computeRecap()\nFailed addPointsFromMapping: ${err.message}`);
        throw err;
    }
};

const createScoreObject = async (options: any): Promise<any> => {
    const pidsWithScores: any[] = options.pidsWithScores;
    const isObjectFormat = pidsWithScores.length > 0 && typeof pidsWithScores[0] === "object";

    const pids: string[] = isObjectFormat
        ? pidsWithScores.filter(p => p?.value).map(p => p.value)
        : pidsWithScores.filter((_, i) => i % 2 === 0 && pidsWithScores[i] !== "");

    if (pids.length === 0) {
        const scoreInfos: any = { __class: options.returnContainer };
        scoreInfos[options.rank]           = options.currentRank;
        scoreInfos[options.scoreContainer] = [];
        if (options.totalPlayers) scoreInfos[options.totalPlayers] = options.playerCount;
        return scoreInfos;
    }

    try {
        let dancerCardInfos = await wdfSessions.getPlayerInfo({ room: options.room, pids });
        if (!Array.isArray(dancerCardInfos)) dancerCardInfos = [];

        const scores: any[] = [];
        for (let i = 0; i < dancerCardInfos.length; i++) {
            const scoreObject: any = dancerCardInfos[i];
            if (!scoreObject) continue;
            scoreObject.__class = options.returnEntry;
            if (isObjectFormat) {
                scoreObject.pid   = pidsWithScores[i].value;
                scoreObject.score = parseFloat(pidsWithScores[i].score);
            } else {
                scoreObject.pid   = pidsWithScores[i * 2];
                scoreObject.score = parseFloat(pidsWithScores[i * 2 + 1]);
            }
            scores.push(scoreObject);
        }

        const scoreInfos: any = { __class: options.returnContainer };
        scoreInfos[options.rank]           = options.currentRank;
        scoreInfos[options.scoreContainer] = scores;
        if (options.totalPlayers) scoreInfos[options.totalPlayers] = options.playerCount;
        return scoreInfos;
    } catch (err: any) {
        logger.error(`[${options.room}] wdfScoring::tournament::createScoreObject()\nFailed: ${err.message}`);
        throw err;
    }
};

const getScoreInfo = async (options: any): Promise<any> => {
    const luaScript = "local newRank = redis.call('zrevrank', KEYS[1], ARGV[1]); if newRank == false then newRank = -1; end; local lowerLimit; lowerLimit = newRank <= 4 and 0 or newRank - 4; return {newRank ,redis.call('zrevrange', KEYS[1], lowerLimit, newRank + 4, 'WITHSCORES')}";

    try {
        const value: any = await redis.eval(luaScript, { keys: [options.key], arguments: [options.pid] });
        value[0] = parseInt(value[0]) + 1;
        return await createScoreObject({ ...options, pidsWithScores: value[1], currentRank: value[0], rank: "currentRank" });
    } catch (err: any) {
        logger.error(`[${options.room}] wdfScoring::tournament::getScoreInfo()\nFailed: ${err.message}`);
        throw err;
    }
};

export const updateScore = async (options: any): Promise<any> => {
    try {
        const multi = redis.multi();
        multi.get(keys.tournamentType(options.room));
        multi.zAdd(keys.playerScores(options.room), { score: options.score.score, value: options.pid });
        multi.zCard(keys.playerScores(options.room));
        const results = await multi.exec() as any[];

        const scoreInfo = await getScoreInfo({
            ...options,
            key: keys.playerScores(options.room),
            scoreContainer: "scoreEntries",
            returnEntry: "ScoreEntry",
            returnContainer: "UpdateScoreResult"
        });

        scoreInfo.totalPlayers = parseInt(results[2]);
        return scoreInfo;
    } catch (err: any) {
        logger.error(`[${options.room}] wdfScoring::tournament::updateScore()\nFailed: ${err.message}`);
        throw err;
    }
};

export const getRecap = async (options: any): Promise<any> => {
    try {
        const recapComputed = await redis.get(keys.recapComputed(options.room));
        if (recapComputed !== "true") return { __class: "RecapInfo", recapComputed: false };

        const recapKey = options.state?.currentRound === options.state?.playlistLength
            ? keys.tournamentRecap(options.room)
            : keys.recap(options.room);

        return await getScoreInfo({
            ...options,
            key: recapKey,
            scoreContainer: "scoreEntries",
            returnEntry: "ScoreEntry",
            returnContainer: "RecapInfo"
        });
    } catch (err: any) {
        logger.error(`[${options.room}] wdfScoring::tournament::getRecap()\nFailed: ${err.message}`);
        throw err;
    }
};

export const getScoreStatus = async (options: any): Promise<any> => {
    try {
        const score = await redis.zScore(keys.playerScores(options.room), options.pid);
        return { __class: "InitScoreResult", score: score !== null ? parseFloat(score as any) : 0 };
    } catch (err: any) {
        logger.error(`[${options.room}] wdfScoring::tournament::getScoreStatus()\nFailed: ${err.message}`);
        throw err;
    }
};

export const resetComputeRecap = async (options: any): Promise<void> => {
    const multi = redis.multi();
    multi.del(keys.recapComputed(options.room));
    multi.del(keys.recap(options.room));
    multi.del(keys.playerScores(options.room));
    await multi.exec();
};
