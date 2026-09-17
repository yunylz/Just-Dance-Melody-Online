import { file } from "../lib/cache";
import { createLogger } from "../lib/logger";
import { client as redis } from "../lib/redis";
import { WdfClients } from "../types/wdf";

const logger = createLogger({ service: "wdf/stats" });

let wdfSchedule: any;
let wdfSessions: any;

const oneWeek = 7 * 24 * 60 * 60 * 1000;

const updatePlayerProfile = async (_key: string, _gameVersion: string): Promise<void> => { return; };

// ─── Boss stats ────────────────────────────────────────────────────────────────

const bossKeys = {
    totalStars:                      (r: string) => `wdf:rooms:${r}:stats:boss:stars-total`,
    currentBossFamilyName:           (r: string) => `wdf:rooms:${r}:stats:boss:currentBossFamilyName`,
    bossBeatenCount:                 (r: string, l: number) => `wdf:rooms:${r}:stats:boss:boss${l}BeatenCount`,
    bossName:                        (r: string, l: number) => `wdf:rooms:${r}:stats:boss:boss${l}Name`,
    pictureUrl:                      (r: string, l: number) => `wdf:rooms:${r}:stats:boss:boss${l}PictureUrl`,
    playerBossBeatCounts:            (r: string) => `wdf:rooms:${r}:stats:boss:player-boss-beatenCount`,
    lastWeekMostBossesBeatenPlayer:  (r: string) => `wdf:rooms:${r}:stats:boss:lastWeekMostBossesBeatenPlayer`,
    currentWeekMostBossesBeatenPlayer: (r: string) => `wdf:rooms:${r}:stats:boss:currentWeekMostBossesBeatenPlayer`,
    lastWeekPlayerComputeTime:       (r: string) => `wdf:rooms:${r}:stats:boss:lastWeekPlayerComputeTime`,
};

async function computeBossLastWeekPlayer(room: string): Promise<void> {
    const multi = (redis as any).multi();
    multi.get(bossKeys.currentWeekMostBossesBeatenPlayer(room));
    multi.del(bossKeys.playerBossBeatCounts(room));
    multi.del(bossKeys.currentWeekMostBossesBeatenPlayer(room));
    const replies = await multi.exec();
    if (replies?.[0]?.length > 0) await (redis as any).set(bossKeys.lastWeekMostBossesBeatenPlayer(room), replies[0]);
}

async function bossStat_getBossBeatenCount(room: string, level: number): Promise<number | null> {
    const value = await (redis as any).get(bossKeys.bossBeatenCount(room, level));
    return value ? parseInt(value) : null;
}

const bossThemeStats = {
    preProcess: async (room: string, data: any): Promise<void> => {
        const bossDb = file<any>("/data/bosses.json").bosses;
        const now = Date.now();
        try {
            for (const key of [bossKeys.lastWeekMostBossesBeatenPlayer(room), bossKeys.currentWeekMostBossesBeatenPlayer(room)]) {
                await updatePlayerProfile(key, data.roomGameVersion);
            }
        } catch (err: any) { logger.error(`themeStats::boss::preProcess(): ${err.message}`); throw err; }

        let existingFamilyName: string | null = null;
        try { existingFamilyName = await (redis as any).get(bossKeys.currentBossFamilyName(room)); }
        catch (err: any) { logger.error(`themeStats::boss::preProcess(): ${err.message}`); throw err; }

        try {
            const val = await (redis as any).get(bossKeys.lastWeekPlayerComputeTime(room));
            if (val && now >= parseInt(val)) {
                await computeBossLastWeekPlayer(room);
                await (redis as any).del(bossKeys.lastWeekPlayerComputeTime(room));
            }
        } catch (err: any) { logger.error(`themeStats::boss::preProcess(): ${err.message}`); throw err; }

        if (data.familyName && existingFamilyName !== data.familyName) {
            const multi = (redis as any).multi();
            multi.set(bossKeys.lastWeekPlayerComputeTime(room), now + oneWeek);
            multi.set(bossKeys.currentBossFamilyName(room), data.familyName);
            for (let l = 1; l <= 3; l++) {
                multi.del(bossKeys.bossBeatenCount(room, l));
                multi.del(bossKeys.bossName(room, l));
                multi.del(bossKeys.pictureUrl(room, l));
            }
            await multi.exec();
            await computeBossLastWeekPlayer(room);
        }

        if (data.level && data.beaten) await (redis as any).incr(bossKeys.bossBeatenCount(room, data.level));
        if (data.level && data.bossFullName) await (redis as any).set(bossKeys.bossName(room, data.level), data.bossFullName);
        if (data.level && data.bossName && bossDb?.bosses?.[data.bossName]?.newsFeedPictureUrl) {
            await (redis as any).set(bossKeys.pictureUrl(room, data.level), bossDb.bosses[data.bossName].newsFeedPictureUrl);
        }
    },
    stats: {
        totalStars: {
            get: async (room: string) => { const v = await (redis as any).get(bossKeys.totalStars(room)); return v ? parseInt(v) : null; },
            put: async (room: string, data: any) => { if (data.stars) await (redis as any).incrBy(bossKeys.totalStars(room), data.stars); }
        },
        boss1BeatenCount: { get: (r: string) => bossStat_getBossBeatenCount(r, 1), put: async () => {} },
        boss2BeatenCount: { get: (r: string) => bossStat_getBossBeatenCount(r, 2), put: async () => {} },
        boss3BeatenCount: { get: (r: string) => bossStat_getBossBeatenCount(r, 3), put: async () => {} },
        boss1Name: { get: async (r: string) => (redis as any).get(bossKeys.bossName(r, 1)), put: async () => {} },
        boss2Name: { get: async (r: string) => (redis as any).get(bossKeys.bossName(r, 2)), put: async () => {} },
        boss3Name: { get: async (r: string) => (redis as any).get(bossKeys.bossName(r, 3)), put: async () => {} },
        boss1PictureUrl: { get: async (r: string) => (redis as any).get(bossKeys.pictureUrl(r, 1)), put: async () => {} },
        boss2PictureUrl: { get: async (r: string) => (redis as any).get(bossKeys.pictureUrl(r, 2)), put: async () => {} },
        boss3PictureUrl: { get: async (r: string) => (redis as any).get(bossKeys.pictureUrl(r, 3)), put: async () => {} },
        currentWeekMostBossesBeatenPlayer: {
            get: async (room: string) => {
                const v = await (redis as any).get(bossKeys.currentWeekMostBossesBeatenPlayer(room));
                return v ? JSON.parse(v) : null;
            },
            put: async (room: string, data: any) => {
                if (!data.beaten || !Array.isArray(data.players)) return;
                const multi = (redis as any).multi();
                for (const pid of data.players) multi.zIncrBy(bossKeys.playerBossBeatCounts(room), 1, pid);
                multi.zRange(bossKeys.playerBossBeatCounts(room), -1, -1);
                multi.get(bossKeys.currentWeekMostBossesBeatenPlayer(room));
                const results = await multi.exec();
                const existingRaw = results[results.length - 1];
                const topPlayerArr = results[results.length - 2];
                const topPlayer = topPlayerArr?.[0];
                if (!topPlayer) return;
                let existing: any = null;
                try { existing = JSON.parse(existingRaw); } catch { }
                if (existing?.pid === topPlayer) return;
                const info = await wdfSessions.getPlayerInfo({ room, pids: [topPlayer] });
                if (!info?.[0]) return;
                info[0].pid = topPlayer;
                await (redis as any).set(bossKeys.currentWeekMostBossesBeatenPlayer(room), JSON.stringify(info[0]));
            },
            isPlayerStat: true
        },
        lastWeekMostBossesBeatenPlayer: {
            get: async (room: string) => {
                const v = await (redis as any).get(bossKeys.lastWeekMostBossesBeatenPlayer(room));
                return v ? JSON.parse(v) : null;
            },
            put: async () => {},
            isPlayerStat: true
        }
    }
};

// ─── Vote stats ────────────────────────────────────────────────────────────────

const voteKeys = {
    stars:          (r: string) => `wdf:rooms:${r}:stats:vote:stars`,
    totalStars:     (r: string) => `wdf:rooms:${r}:stats:vote:stars-total`,
    mostVotedTrack: (r: string) => `wdf:rooms:${r}:stats:vote:voted-tracks`,
    maxStarsMap:    (r: string) => `wdf:rooms:${r}:stats:vote:max-stars-map`,
};

const voteThemeStats = {
    preProcess: async (room: string, data: any): Promise<void> => {
        if (data.stars) {
            await (redis as any).incrBy(voteKeys.stars(room), data.stars);
            await (redis as any).incrBy(voteKeys.totalStars(room), data.stars);
            if (data.mapName) await (redis as any).zIncrBy(voteKeys.maxStarsMap(room), data.stars, data.mapName);
        }
    },
    stats: {
        stars: { get: async (r: string) => { const v = await (redis as any).get(voteKeys.stars(r)); return v ? parseInt(v) : null; }, put: async () => {} },
        totalStars: { get: async (r: string) => { const v = await (redis as any).get(voteKeys.totalStars(r)); return v ? parseInt(v) : null; }, put: async () => {} },
        mostVotedTrackEver: {
            get: async (room: string) => { const v = await (redis as any).zRange(voteKeys.mostVotedTrack(room), -1, -1); return v?.length ? v[0] : null; },
            put: async (room: string, data: any) => { if (data.mapName) await (redis as any).zIncrBy(voteKeys.mostVotedTrack(room), 1, data.mapName); }
        },
        maxStarsMap: { get: async (r: string) => { const v = await (redis as any).zRange(voteKeys.maxStarsMap(r), -1, -1); return v?.length ? v[0] : null; }, put: async () => {} },
        maxStarsMapStarCount: {
            get: async (r: string) => { const v = await (redis as any).zRangeWithScores(voteKeys.maxStarsMap(r), -1, -1); return v?.length ? parseInt(v[1]) : null; },
            put: async () => {}
        }
    }
};

// ─── Teambattle stats ──────────────────────────────────────────────────────────

const tbKeys = {
    totalStars:    (r: string) => `wdf:rooms:${r}:stats:teambattle:stars-total`,
    totalPlayCount:(r: string) => `wdf:rooms:${r}:stats:teambattle:totalPlayCount`,
};

const teambattleThemeStats = {
    stats: {
        totalStars:    { get: async (r: string) => { const v = await (redis as any).get(tbKeys.totalStars(r)); return v ? parseInt(v) : null; }, put: async (r: string, d: any) => { if (d.stars) await (redis as any).incrBy(tbKeys.totalStars(r), d.stars); } },
        totalPlayCount:{ get: async (r: string) => { const v = await (redis as any).get(tbKeys.totalPlayCount(r)); return v ? parseInt(v) : null; }, put: async (r: string) => { await (redis as any).incr(tbKeys.totalPlayCount(r)); } }
    }
};

// ─── Tournament stats ──────────────────────────────────────────────────────────

const tKeys = {
    totalStars:                    (r: string) => `wdf:rooms:${r}:stats:tournament:stars-total`,
    latestWinner:                  (r: string) => `wdf:rooms:${r}:stats:tournament:latestWinner`,
    tournamentWinnersCount:        (r: string) => `wdf:rooms:${r}:stats:tournament:tournamentWinnersCount`,
    currentWeekMostTournamentsWinner:(r: string) => `wdf:rooms:${r}:stats:tournament:currentWeekMostTournamentsWinner`,
    lastWeekMostTournamentsWinner: (r: string) => `wdf:rooms:${r}:stats:tournament:lastWeekMostTournamentsWinner`,
    weeklyScheduledTournamentWinner:(r: string) => `wdf:rooms:${r}:stats:tournament:weeklyScheduledTournamentWinner`,
    lastWeekPlayerComputeTime:     (r: string) => `wdf:rooms:${r}:stats:tournament:lastWeekPlayerComputeTime`,
};

const tournamentThemeStats = {
    preProcess: async (room: string, data: any): Promise<void> => {
        const now = Date.now();
        const d = new Date(now);
        const dow = d.getUTCDay(), h = d.getUTCHours(), m = d.getUTCMinutes(), s = d.getUTCSeconds(), ms = d.getUTCMilliseconds();
        const timeDiff = dow*86400000 + h*3600000 + m*60000 + s*1000 + ms;

        for (const key of [tKeys.currentWeekMostTournamentsWinner(room), tKeys.lastWeekMostTournamentsWinner(room), tKeys.weeklyScheduledTournamentWinner(room)]) {
            await updatePlayerProfile(key, data.roomGameVersion);
        }

        let lwpct: number;
        const rawLwpct = await (redis as any).get(tKeys.lastWeekPlayerComputeTime(room));
        lwpct = rawLwpct ? parseInt(rawLwpct) : now - timeDiff + oneWeek;

        const multi = (redis as any).multi();
        let computing = false;
        if (now >= lwpct) {
            computing = true;
            multi.get(tKeys.currentWeekMostTournamentsWinner(room));
            multi.del(tKeys.tournamentWinnersCount(room));
            multi.del(tKeys.currentWeekMostTournamentsWinner(room));
            lwpct += oneWeek;
        }
        multi.set(tKeys.lastWeekPlayerComputeTime(room), lwpct);
        const replies = await multi.exec();
        if (computing && replies[0]) await (redis as any).set(tKeys.lastWeekMostTournamentsWinner(room), replies[0]);

        const multi2 = (redis as any).multi();
        if (data.winner) multi2.zIncrBy(tKeys.tournamentWinnersCount(room), 1, data.winner);
        multi2.zRange(tKeys.tournamentWinnersCount(room), -1, -1);
        multi2.get(tKeys.currentWeekMostTournamentsWinner(room));
        const replies2 = await multi2.exec();
        const existingRaw = replies2[data.winner ? 2 : 1];
        const topPlayerArr = replies2[data.winner ? 1 : 0];
        const topPlayer = topPlayerArr?.[0];
        let existingWinner: any = null;
        try { existingWinner = JSON.parse(existingRaw); } catch { }

        if (data.winner) {
            const info = await wdfSessions.getPlayerInfo({ room, pids: [data.winner] });
            if (!info?.[0]) return;
            info[0].pid = data.winner;
            const multi3 = (redis as any).multi();
            multi3.set(tKeys.latestWinner(room), JSON.stringify(info[0]));
            if (!existingWinner || existingWinner.pid !== topPlayer) {
                multi3.set(tKeys.currentWeekMostTournamentsWinner(room), JSON.stringify(info[0]));
                existingWinner = info[0];
            }
            await multi3.exec();
        }

        if (data.winner && data.tournamentType === "weekly" && existingWinner) {
            await (redis as any).set(tKeys.weeklyScheduledTournamentWinner(room), JSON.stringify(existingWinner));
        }
    },
    stats: {
        totalStars:                    { get: async (r: string) => { const v = await (redis as any).get(tKeys.totalStars(r)); return v ? parseInt(v) : null; }, put: async (r: string, d: any) => { if (d.stars) await (redis as any).incrBy(tKeys.totalStars(r), d.stars); } },
        latestWinner:                  { get: async (r: string) => { const v = await (redis as any).get(tKeys.latestWinner(r)); return v ? JSON.parse(v) : null; }, put: async () => {}, isPlayerStat: true },
        currentWeekMostTournamentsWinner:{ get: async (r: string) => { const v = await (redis as any).get(tKeys.currentWeekMostTournamentsWinner(r)); return v ? JSON.parse(v) : null; }, put: async () => {}, isPlayerStat: true },
        lastWeekMostTournamentsWinner: { get: async (r: string) => { const v = await (redis as any).get(tKeys.lastWeekMostTournamentsWinner(r)); return v ? JSON.parse(v) : null; }, put: async () => {}, isPlayerStat: true },
        weeklyScheduledTournamentWinner:{ get: async (r: string) => { const v = await (redis as any).get(tKeys.weeklyScheduledTournamentWinner(r)); return v ? JSON.parse(v) : null; }, put: async () => {}, isPlayerStat: true }
    }
};

// ─── Global stats ──────────────────────────────────────────────────────────────

const globalKeys = { totalStars: (r: string) => `wdf:rooms:${r}:stats:global:stars-total` };
const globalStats = {
    stats: {
        totalStars: { get: async (r: string) => { const v = await (redis as any).get(globalKeys.totalStars(r)); return v ? parseInt(v) : null; }, put: async (r: string, d: any) => { if (d.stars) await (redis as any).incrBy(globalKeys.totalStars(r), d.stars); } }
    }
};

// ─── Theme registry ────────────────────────────────────────────────────────────

const themeStats: Record<string, any> = {
    boss:        bossThemeStats,
    vote:        voteThemeStats,
    teambattle:  teambattleThemeStats,
    tournament:  tournamentThemeStats,
};

export const init = async (clients: WdfClients): Promise<void> => {
    wdfSchedule = clients.wdfSchedule;
    wdfSessions = clients.wdfSessions;
};

export const isValidStat = (statName: string): boolean => {
    const parts = statName.split("-");
    if (parts.length !== 2) return false;
    const [theme, stat] = parts;
    return (theme === "global" && Object.prototype.hasOwnProperty.call(globalStats.stats, stat)) ||
        (Object.prototype.hasOwnProperty.call(themeStats, theme) && Object.prototype.hasOwnProperty.call(themeStats[theme].stats, stat));
};

export const isPlayerStat = (statName: string): boolean => {
    if (!isValidStat(statName)) return false;
    const [theme, stat] = statName.split("-");
    return theme === "global" ? !!(globalStats.stats[stat as keyof typeof globalStats.stats] as any)?.isPlayerStat : !!themeStats[theme].stats[stat]?.isPlayerStat;
};

export const get = async (room: string, statName: string): Promise<any> => {
    if (!isValidStat(statName)) return null;
    const [theme, stat] = statName.split("-");
    if (theme === "global") return globalStats.stats[stat as keyof typeof globalStats.stats].get(room);
    return themeStats[theme].stats[stat].get(room);
};

export const put = async (room: string, theme: string, data: any): Promise<void> => {
    if (!themeStats[theme]) return;
    if (globalStats.hasOwnProperty("preProcess")) await (globalStats as any).preProcess(room, data);
    for (const stat of Object.values(globalStats.stats)) await (stat as any).put(room, data);
    if (themeStats[theme].hasOwnProperty("preProcess")) await themeStats[theme].preProcess(room, data);
    for (const stat of Object.values(themeStats[theme].stats)) await (stat as any).put(room, data);
};
