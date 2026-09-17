import { createLogger } from "../../lib/logger";
import { client as redis } from "../../lib/redis";
import { WdfClients } from "../../types/wdf";

const logger = createLogger({ service: "wdf/scoring/teambattle" });

let wdfSessions: any;
let wdfLeaderboard: any;
let wdfStats: any;

const keys = {
    playerScores: (room: string, team: string) => `wdf:rooms:${room}:player-scores:${team}`,
    lastStarInfo: (room: string, team: string) => `wdf:rooms:${room}:teambattle:last-star-info:${team}`,
    teamScores:   (room: string)               => `wdf:rooms:${room}:teambattle:theme-score`,
    lastStar:     (room: string, team: string) => `wdf:rooms:${room}:teambattle:last-star:${team}`,
    firstStar:    (room: string)               => `wdf:rooms:${room}:teambattle:first-star`,
    longestStreak:(room: string)               => `wdf:rooms:${room}:teambattle:perfect-streaks`,
    recap:        (room: string)               => `wdf:rooms:${room}:score-recap`,
    recapComputed:(room: string)               => `wdf:rooms:${room}:recap-computed`,
};

export const init = (clients: WdfClients): void => {
    wdfSessions    = clients.wdfSessions;
    wdfLeaderboard = clients.wdfLeaderboard;
    wdfStats       = clients.wdfStats;
};

const calculateStars = (score: number): number => {
    const sixthStarValue  = 5.5;
    const seventhStarValue = 6;
    let stars = 0;
    const playerStars = (score * 13333) / 2000;
    if (playerStars > sixthStarValue && playerStars < seventhStarValue) {
        stars = 6;
    } else if (playerStars > seventhStarValue) {
        stars = 7;
    } else {
        stars = playerStars;
    }
    return Math.floor(stars);
};

export const cleanUp = async (options: any): Promise<void> => {
    try {
        const multi = redis.multi();
        for (const team of options.state.teams) {
            for (const key of Object.keys(keys)) {
                const fn: any = (keys as any)[key];
                if (fn.length === 2) multi.del(fn(options.room, team));
                else multi.del(fn(options.room));
            }
        }
        await multi.exec();
    } catch (err: any) {
        logger.error(`wdfScoring::teambattle::cleanUp(): Error: ${err.message}`);
        throw err;
    }
};

export const start = async (options: any): Promise<void> => {
    try {
        await cleanUp(options);
        const teamScores: Record<string, any> = {};
        for (const team of options.state.teams) {
            teamScores[team] = { score: 0, stars: 0 };
        }
        await redis.set(keys.teamScores(options.room), JSON.stringify(teamScores));
    } catch (err: any) {
        logger.error(`wdfScoring::teambattle::start(): Error: ${err.message}`);
        throw err;
    }
};

export const update = async (options: any): Promise<void> => {
    try {
        const teamScores: Record<string, any> = {};
        for (const team of options.teams) {
            teamScores[team] = {};
            const values = await redis.zRangeWithScores(keys.playerScores(options.room, team), 0, -1);
            let teamScore = 0, teamStars = 0;
            for (const entry of values) {
                const score = parseFloat(entry.score as any);
                teamScore += score;
                teamStars += calculateStars(score);
            }
            teamScores[team].score = teamScore;
            teamScores[team].stars = teamStars;
        }

        const multi = redis.multi();
        multi.set(keys.teamScores(options.room), JSON.stringify(teamScores));

        for (const team of options.teams) {
            const reply = await redis.get(keys.lastStar(options.room, team));
            if (reply) {
                const currentLastStarPlayer = JSON.parse(String(reply));
                if (!currentLastStarPlayer?.pid) continue;
                const dancerCardInfo = await wdfSessions.getPlayerInfo({ room: options.room, pids: [currentLastStarPlayer.pid] });
                const lastStarInfo: any = dancerCardInfo[0];
                lastStarInfo.__class    = "TeamBattleEntry";
                lastStarInfo.identifier = "lastStar";
                lastStarInfo.pid        = currentLastStarPlayer.pid;
                lastStarInfo.team       = team;
                lastStarInfo.score      = currentLastStarPlayer.score;
                multi.set(keys.lastStarInfo(options.room, team), JSON.stringify(lastStarInfo));
            }
        }
        await multi.exec();
    } catch (err: any) {
        logger.error(`wdfScoring::teambattle::update(): Error: ${err.message}`);
        throw err;
    }
};

export const updateScore = async (options: any): Promise<any> => {
    if (!options.score.team)
        throw new Error(`pid: ${options.pid} sent score without team from room: ${options.room}`);
    if (!Object.prototype.hasOwnProperty.call(options.score, "timestamp"))
        throw new Error(`pid: ${options.pid} sent score without timestamp from room: ${options.room}`);

    const playerStars = Math.floor((options.score.score * 13333) / 2000);
    let teamBattleEntries: any[] = [];
    let teamScores: Record<string, any> = {};
    let teams: string[] = [];
    let previousPlayerStars = 0;
    let previousStreak = 0;

    try {
        const multi = redis.multi();
        multi.zScore(keys.playerScores(options.room, options.score.team), options.pid);
        multi.get(keys.teamScores(options.room));
        multi.zAdd(keys.playerScores(options.room, options.score.team), { score: options.score.score, value: options.pid });
        multi.zScore(keys.longestStreak(options.room), options.pid);
        const replies = await multi.exec() as any[];

        previousPlayerStars = replies[0] ? Math.floor((parseFloat(replies[0]) * 13333) / 2000) : 0;
        teamScores          = JSON.parse(replies[1]);
        previousStreak      = replies[3] ? parseInt(replies[3]) : 0;
        teams               = Object.keys(teamScores);
    } catch (err: any) {
        logger.error(`wdfScoring::teambattle::updateScore(): Error updating score: ${err.message}`);
        throw err;
    }

    try {
        const multi = redis.multi();
        if (previousStreak < options.score.streak)
            multi.zAdd(keys.longestStreak(options.room), { score: options.score.streak, value: options.pid });
        if (playerStars > previousPlayerStars) {
            const starData = JSON.stringify({ pid: options.pid, team: options.score.team, score: options.score.score, timestamp: options.score.timestamp });
            multi.set(keys.lastStar(options.room, options.score.team), starData);
            multi.setNX(keys.firstStar(options.room), starData);
        }
        await multi.exec();
    } catch (err: any) {
        logger.error(`wdfScoring::teambattle::updateScore(): Error updating last star: ${err.message}`);
        throw err;
    }

    try {
        const multi = redis.multi();
        for (const team of teams) multi.get(keys.lastStarInfo(options.room, team));
        const replies = await multi.exec() as any[];
        for (const reply of replies) {
            if (reply) teamBattleEntries.push(JSON.parse(reply));
        }
    } catch (err: any) {
        logger.error(`wdfScoring::teambattle::updateScore(): Error getting last star info: ${err.message}`);
        throw err;
    }

    const teamBattleStatus: any = { __class: "TeamBattleStatus", teamScores: [] };
    for (const team of teams) {
        teamScores[team].__class   = "TeamScore";
        teamScores[team].name      = team;
        teamScores[team].clientTeam = options.score.team === team;
        teamBattleStatus.teamScores.push(teamScores[team]);
    }

    return { __class: "UpdateScoreResult", teamBattleStatus, teamBattleEntries };
};

export const getScoreStatus = async (options: any): Promise<any> => {
    try {
        const reply = await redis.get(keys.teamScores(options.room));
        const teamScores: Record<string, any> = reply ? JSON.parse(String(reply)) : {};
        const teams = Object.keys(teamScores);

        let playerScore = 0;
        let playerTeam = "";

        const multi = redis.multi();
        for (const team of teams) multi.zScore(keys.playerScores(options.room, team), options.pid);
        const replies = await multi.exec() as any[];

        for (let i = 0; i < teams.length; i++) {
            if (replies[i] !== null) {
                playerScore = parseFloat(replies[i]);
                playerTeam  = teams[i];
            }
        }

        const teamBattleStatus: any = { __class: "TeamBattleStatus", teamScores: [] };
        for (const team of teams) {
            teamScores[team].__class   = "TeamScore";
            teamScores[team].name      = team;
            teamScores[team].clientTeam = playerTeam === team;
            teamBattleStatus.teamScores.push(teamScores[team]);
        }

        return { __class: "InitScoreResult", score: playerScore, teamBattleStatus };
    } catch (err: any) {
        logger.error(`wdfScoring::teambattle::getScoreStatus(): Error: ${err.message}`);
        throw err;
    }
};

export const computeRecap = async (options: any): Promise<void> => {
    try {
        const reply = await redis.get(keys.teamScores(options.room));
        const teamScores: Record<string, any> = reply ? JSON.parse(String(reply)) : {};
        const teams = Object.keys(teamScores);

        const winningTeam = teams.reduce((a, b) => teamScores[a].stars >= teamScores[b].stars ? a : b, teams[0]);

        for (const team of teams) {
            await wdfLeaderboard.addPointsFromScore({
                room: options.room,
                playerScoresKey: keys.playerScores(options.room, team),
                roomGameVersion: options.state.roomGameVersion
            });
        }

        const recapData: any = {
            __class: "RecapInfo",
            teamBattleStatus: { __class: "TeamBattleStatus", teamScores: Object.values(teamScores) },
            winningTeam
        };

        const multi = redis.multi();
        multi.set(keys.recap(options.room), JSON.stringify(recapData));
        multi.set(keys.recapComputed(options.room), "true");
        await multi.exec();
    } catch (err: any) {
        logger.error(`wdfScoring::teambattle::computeRecap(): Error: ${err.message}`);
        throw err;
    }
};

export const getRecap = async (options: any): Promise<any> => {
    try {
        const recapComputed = await redis.get(keys.recapComputed(options.room));
        if (recapComputed !== "true") return { __class: "RecapInfo", recapComputed: false };
        const data = await redis.get(keys.recap(options.room));
        if (!data) return { __class: "RecapInfo", recapComputed: false };
        const recapResponse = JSON.parse(String(data));
        recapResponse.recapComputed = true;
        return recapResponse;
    } catch (err: any) {
        logger.error(`wdfScoring::teambattle::getRecap(): Error: ${err.message}`);
        throw err;
    }
};

export const resetComputeRecap = async (options: any): Promise<void> => {
    const multi = redis.multi();
    multi.del(keys.recapComputed(options.room));
    multi.del(keys.recap(options.room));
    await multi.exec();
};
