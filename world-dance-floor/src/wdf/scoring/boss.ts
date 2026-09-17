import { file } from "../../lib/cache";
import { createLogger } from "../../lib/logger";
import { client as redis } from "../../lib/redis";
import { WdfClients, WdfConfig } from "../../types/wdf";

const logger = createLogger({ service: "wdf/themes/boss" });
const wdfConfig = file<{ config: WdfConfig }>("/data/config.json").config;

let wdfSessions: any;
let wdfStats: any;
let wdfLeaderboard: any;

const keys = {
    playerScores:    (room: string) => `wdf:rooms:${room}:player-scores`,
    recap:           (room: string) => `wdf:rooms:${room}:score-recap`,
    lastStar:        (room: string) => `wdf:rooms:${room}:boss:last-star`,
    finalBlow:       (room: string) => `wdf:rooms:${room}:boss:final-blow`,
    bossStatus:      (room: string) => `wdf:rooms:${room}:boss:boss-status`,
    playerEnergies:  (room: string) => `wdf:rooms:${room}:player-energies`,
    recentStarPlayer:(room: string) => `wdf:rooms:${room}:recent-star-player`,
    recapComputed:   (room: string) => `wdf:rooms:${room}:recap-computed`,
};

const calculateStars = (score: number, roomGameVersion: string): number => {
    const sixthStarValue = 5.5;
    const seventhStarValue = 6;
    let stars = 0;
    const playerStars = (score * 13333) / 2000;

    if (roomGameVersion === "jd2017") {
        stars = playerStars > sixthStarValue ? 6 : playerStars;
    } else {
        if (playerStars > sixthStarValue && playerStars < seventhStarValue) {
            stars = 6;
        } else if (playerStars > seventhStarValue) {
            stars = 7;
        } else {
            stars = playerStars;
        }
    }
    return Math.floor(stars);
};

export const init = (clients: WdfClients): void => {
    wdfSessions  = clients.wdfSessions;
    wdfStats     = clients.wdfStats;
    wdfLeaderboard = clients.wdfLeaderboard;
};

const clearPlayerScoreData = async (options: any): Promise<void> => {
    try {
        const multi = redis.multi();
        multi.zUnionStore(keys.playerScores(options.room), [keys.playerScores(options.room)], { weights: [0] } as any);
        multi.zUnionStore(keys.playerEnergies(options.room), [keys.playerEnergies(options.room)], { weights: [0] } as any);
        multi.del(keys.lastStar(options.room));
        multi.del(keys.finalBlow(options.room));
        multi.del(keys.recentStarPlayer(options.room));
        await multi.exec();
    } catch (err: any) {
        logger.error(`[${options.room}] wdfScoring::boss::clearPlayerScoreData()\nFailed: ${err.message}`);
        throw err;
    }
};

export const cleanUp = async (options: any): Promise<void> => {
    try {
        const multi = redis.multi();
        for (const key of Object.keys(keys)) {
            multi.del((keys as any)[key](options.room));
        }
        await multi.exec();
    } catch (err: any) {
        logger.error(`[${options.room}] wdfScoring::boss::cleanUp()\nFailed: ${err.message}`);
        throw err;
    }
};

export const start = async (options: any): Promise<void> => {
    try {
        await cleanUp(options);
        await redis.set(keys.bossStatus(options.room), JSON.stringify({
            bossHealth: options.state.bossState.bossMaxHealth,
            bossMaxHealth: options.state.bossState.bossMaxHealth,
            previousRoundStars: 0
        }));
    } catch (err: any) {
        logger.error(`[${options.room}] wdfScoring::boss::start()\nFailed: ${err.message}`);
        throw err;
    }
};

export const computeRecap = async (options: any): Promise<void> => {
    try {
        const multi = redis.multi();
        multi.get(keys.bossStatus(options.room));
        multi.zRangeWithScores(keys.playerScores(options.room), 0, 0, { REV: true });
        multi.zRangeWithScores(keys.playerEnergies(options.room), 0, 0, { REV: true });
        multi.get(keys.lastStar(options.room));
        multi.get(keys.finalBlow(options.room));
        const replies = await multi.exec() as any[];

        const pids: string[] = [];
        const identifiers: any[] = [];
        let bossStatus: any;

        if (replies[1]?.length > 0) {
            identifiers.push({ identifier: "topScorer",  highlightScore: parseFloat(replies[1][0].score), pid: replies[1][0].value });
        }
        if (replies[2]?.length > 0) {
            identifiers.push({ identifier: "topEnergy",  highlightScore: parseFloat(replies[2][0].score), pid: replies[2][0].value });
        }
        if (replies[3]) {
            const lastStar = JSON.parse(replies[3]);
            identifiers.push({ identifier: "lastStar", highlightScore: lastStar.score, pid: lastStar.pid });
        }
        if (replies[4]) {
            const finalBlow = JSON.parse(replies[4]);
            identifiers.push({ identifier: "finalBlow", highlightScore: finalBlow.score, pid: finalBlow.pid });
        }

        for (const id of identifiers) pids.push(id.pid);

        const highlights: any[] = [];
        if (pids.length > 0) {
            const dancerCardInfos = await wdfSessions.getPlayerInfo({ room: options.room, pids });
            if (Array.isArray(dancerCardInfos)) {
                for (let i = 0; i < dancerCardInfos.length; i++) {
                    const highlight: any = dancerCardInfos[i];
                    if (highlight && identifiers[i]) {
                        highlight.__class     = "BossEntry";
                        highlight.pid         = identifiers[i].pid;
                        highlight.bossEntryType = identifiers[i].identifier;
                        highlight.score       = identifiers[i].highlightScore;
                        highlights.push(highlight);
                    }
                }
            }
        }

        bossStatus = JSON.parse(replies[0]);
        if (!bossStatus) throw new Error("No boss status data available for recap computation");

        const recapData: any = {
            __class: "RecapInfo",
            bossStatus: {
                __class: "BossStatus",
                bossHealth: bossStatus.bossHealth < 0 ? 0 : bossStatus.bossHealth,
                bossMaxHealth: bossStatus.bossMaxHealth,
                previousRoundStars: bossStatus.previousRoundStars
            },
            bossEntries: highlights
        };

        bossStatus.previousRoundStars = bossStatus.bossMaxHealth - bossStatus.bossHealth;
        options.state.bossState = bossStatus;

        const multi2 = redis.multi();
        multi2.set(keys.recap(options.room), JSON.stringify(recapData));
        multi2.set(keys.bossStatus(options.room), JSON.stringify(bossStatus));
        multi2.set(keys.recapComputed(options.room), "true");
        await multi2.exec();

        const beaten = bossStatus.bossHealth <= 0;
        if (beaten || options.state.currentRound >= options.state.playlistLength) {
            const players = await wdfSessions.getPlayers({ room: options.room });
            await wdfStats.boss.put(options.room, {
                stars: bossStatus.previousRoundStars,
                familyName: options.state.familyName,
                bossName: options.state.bossName,
                bossFullName: options.state.bossFullName,
                level: options.state.playlistLength,
                beaten,
                players,
                roomGameVersion: options.state.roomGameVersion
            });
        }

        await wdfLeaderboard.addPointsFromScore({
            room: options.room,
            playerScoresKey: keys.playerScores(options.room),
            roomGameVersion: options.state.roomGameVersion
        });

        await clearPlayerScoreData(options);
    } catch (err: any) {
        logger.error(`[${options.room}] wdfScoring::boss::computeRecap()\nFailed: ${err.message}`);
        throw err;
    }
};

export const getRecap = async (options: any): Promise<any> => {
    try {
        const recapComputed = await redis.get(keys.recapComputed(options.room));
        if (recapComputed !== "true") return { __class: "RecapInfo", recapComputed: false };

        const data = await redis.get(keys.recap(options.room));
        let recapResponse: any;
        recapResponse = JSON.parse(String(data!));
        recapResponse.recapComputed = true;

        let onlineRankInfo: any;
        if (options.gameVersion && options.gameVersion !== "jd2017") {
            onlineRankInfo = await wdfLeaderboard.getFormattedOnlineRankInfo({ room: options.room, pid: options.pid });
        }

        return { ...recapResponse, onlineRankInfo };
    } catch (err: any) {
        logger.error(`[${options.room}] wdfScoring::boss::getRecap()\nFailed: ${err.message}`);
        throw err;
    }
};

export const updateScore = async (options: any): Promise<any> => {
    let recentStarPlayer: any[] = [];
    let bossStatus: any;
    const playerStars = Math.floor((options.score.score * 13333) / 2000);
    let previousPlayerStars = 0;

    try {
        const multi = redis.multi();
        multi.get(keys.bossStatus(options.room));
        multi.zScore(keys.playerScores(options.room), options.pid);
        multi.zAdd(keys.playerScores(options.room), { score: options.score.score, value: options.pid });
        multi.get(keys.recentStarPlayer(options.room));
        const replies = await multi.exec() as any[];

        bossStatus = JSON.parse(replies[0]);
        if (!bossStatus) throw new Error("No boss status data available for score update");
        previousPlayerStars = replies[1] ? Math.floor((parseFloat(replies[1]) * 13333) / 2000) : 0;
        const recentPlayerStarData = JSON.parse(replies[3]);
        if (recentPlayerStarData) recentStarPlayer.push(recentPlayerStarData);
    } catch (err: any) {
        logger.error(`[${options.room}] wdfScoring::boss::updateScore()\nFailed to update boss score: ${err.message}`);
        throw err;
    }

    try {
        if (bossStatus && previousPlayerStars < playerStars) {
            const multi = redis.multi();
            multi.set(keys.lastStar(options.room), JSON.stringify({ pid: options.pid, score: playerStars }));
            if (bossStatus.bossHealth < 1) {
                multi.setNX(keys.finalBlow(options.room), JSON.stringify({ pid: options.pid, score: playerStars }));
            }
            if (options.score.energy) {
                multi.zAdd(keys.playerEnergies(options.room), { score: options.score.energy, value: options.pid });
            }
            await multi.exec();
        }
    } catch (err: any) {
        logger.error(`[${options.room}] wdfScoring::boss::updateScore()\nFailed to update boss star data: ${err.message}`);
        return {
            __class: "UpdateScoreResult",
            bossStatus: { __class: "BossStatus", bossHealth: 0, bossMaxHealth: 0, previousRoundStars: 0 }
        };
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

const updateBossHealth = async (options: any): Promise<any> => {
    try {
        const reply = await redis.get(keys.bossStatus(options.room));
        if (!reply) {
            if (options.state?.bossState) return options.state.bossState;
            return { bossHealth: 0, bossMaxHealth: 0, previousRoundStars: 0 };
        }

        const bossStatus = JSON.parse(String(reply));
        const reply2 = await redis.zRangeWithScores(keys.playerScores(options.room), 0, -1, { REV: true });

        let stars = 0;
        for (const entry of reply2) {
            stars += calculateStars(parseFloat(entry.score as any), options.state.roomGameVersion);
        }

        bossStatus.bossHealth = bossStatus.bossMaxHealth - (stars + bossStatus.previousRoundStars);
        await redis.set(keys.bossStatus(options.room), JSON.stringify(bossStatus));
        return bossStatus;
    } catch (err: any) {
        logger.error(`[${options.room}] wdfScoring::boss::updateBossHealth()\nFailed: ${err.message}`);
        throw err;
    }
};

export const getScoreStatus = async (options: any): Promise<any> => {
    try {
        const multi = redis.multi();
        multi.zScore(keys.playerScores(options.room), options.pid);
        multi.get(keys.bossStatus(options.room));
        const replies = await multi.exec() as any[];

        const playerScore = replies[0] ? parseFloat(replies[0]) : 0;
        const bossStatus  = JSON.parse(replies[1]);

        if (!bossStatus) {
            return { score: 0, bossStatus: { __class: "BossStatus", bossHealth: 0, bossMaxHealth: 0, previousRoundStars: 0 }, __class: "InitScoreResult" };
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
    } catch (err: any) {
        logger.error(`[${options.room}] wdfScoring::boss::getScoreStatus()\nFailed: ${err.message}`);
        throw err;
    }
};

export const update = async (options: any): Promise<any> => {
    let bossStatus: any;
    try {
        bossStatus = await updateBossHealth(options);
    } catch (err: any) {
        logger.error(`[${options.room}] wdfScoring::boss::update()\nFailed to update boss health: ${err.message}`);
        throw err;
    }

    try {
        const data = await redis.get(keys.lastStar(options.room));
        const lastStarPlayer = JSON.parse(String(data!));
        if (lastStarPlayer) {
            const dancerCardInfo = await wdfSessions.getPlayerInfo({ room: options.room, pids: [lastStarPlayer.pid] });
            const recentStar: any = dancerCardInfo[0];
            recentStar.__class      = "BossEntry";
            recentStar.pid          = lastStarPlayer.pid;
            recentStar.score        = lastStarPlayer.score;
            recentStar.bossEntryType = "recentStar";
            await redis.set(keys.recentStarPlayer(options.room), JSON.stringify(recentStar));
        }
    } catch (err: any) {
        logger.error(`[${options.room}] wdfScoring::boss::update()\nFailed to update recent star player: ${err.message}`);
        throw err;
    }

    try {
        const numberOfPlayers = await wdfSessions.getNumberOfPlayers(options);
        options.state.maxPlayersSeen = Math.max(numberOfPlayers, options.state.maxPlayersSeen || 0);
    } catch (err: any) {
        logger.error(`[${options.room}] wdfScoring::boss::update()\nFailed to update max players seen: ${err.message}`);
        throw err;
    }

    return bossStatus;
};

export const getPlayerScores = async (options: any): Promise<any[]> => {
    try {
        const reply = await redis.zRangeWithScores(keys.playerScores(options.room), 0, -1, { REV: true });
        return reply.map(e => ({ pid: e.value, score: parseFloat(e.score as any) }));
    } catch (err: any) {
        logger.error(`[${options.room}] wdfScoring::boss::getPlayerScores()\nFailed: ${err.message}`);
        throw err;
    }
};

export const resetComputeRecap = async (options: any): Promise<void> => {
    await redis.set(keys.recapComputed(options.room), "false");
};
