import { createLogger } from "../lib/logger";
import * as oasis from "../lib/oasis";
import { client as redis } from "../lib/redis";
import { WdfClients } from "../types/wdf";

const logger = createLogger({ service: "wdf/notifications" });

let wdfSessions: any;
let wdfScoring: any;
let wdfRoomManager: any;

const startGenerateTime = 10;
const endBufferTime = 20;
const WDF_NOTIFICATION_COMPUTE_DURATION = 40;
const WDF_NOTIFICATION_SHOW_DURATION = 10;
const WDF_NOTIFICATIONS_RESET_TIMEDIFF = 10;

const notifications: Record<string, any> = {
    "nextTheme": {
        type: "fixed",
        constructNotification: async (room: string, _state: any) => {
            try {
                const nextTheme = await wdfRoomManager.getNextThemeDetails(room);
                if (!nextTheme) return null;
                const notification: any = { title: 12453 };
                switch (nextTheme.type) {
                    case "vote": notification.info = 12989; break;
                    case "boss": notification.info = 12985; break;
                    case "spotlight": notification.info = 12986; break;
                    case "tournament": notification.info = 12987; break;
                    case "teambattle": notification.info = 12988; break;
                    case "map": notification.info = 990001; break;
                }
                notification.data = { theme: { value: nextTheme.type === "map" ? "spotlight" : nextTheme.type } };
                return notification;
            } catch (err: any) { logger.error(`Error constructing nextTheme notification for room ${room}: ${err.message}\n${err.stack}`); return null; }
        },
        canShow: async (options: any) => {
            if (!options.room) return null;
            try {
                const nextTheme = await wdfRoomManager.getNextThemeDetails(options.room);
                const now = Date.now() / 1000;
                const showTime = options.state.currentTheme.ingameEndTime - WDF_NOTIFICATION_COMPUTE_DURATION;
                return options.state.currentTheme.lastInGameScreen && now > showTime && nextTheme !== null;
            } catch (err: any) { logger.error(`Error checking canShow for nextTheme in room ${options.room}: ${err.message}\n${err.stack}`); return false; }
        }
    },
    "country": {
        priority: 2, type: "reoccurring",
        constructNotification: async (_room: string, state: any) => {
            const countryCount = state.notificationsList.country.countryCount;
            const country = state.notificationsList.country.countryToShow;
            state.notificationsList.country.countryHistory.push(country);
            return { title: 13478, info: 13479, data: { COUNTRY: { value: country }, NB_PLAYERS: { value: countryCount[country].toString() } } };
        },
        canShow: async (options: any) => {
            if (!options.room || !options.state) return null;
            const state = options.state;
            if (!state.notificationsList.country.countryHistory) state.notificationsList.country.countryHistory = [];
            try {
                const countryCount = await wdfSessions.getCountryCounts({ room: options.room });
                const countryList = Object.keys(countryCount).filter((c: string) => !state.notificationsList.country.countryHistory.includes(c));
                if (countryList.length === 0) return false;
                const country = countryList[Math.round(Math.random() * (countryList.length - 1))];
                state.notificationsList.country.countryCount = countryCount;
                state.notificationsList.country.countryToShow = country;
                return true;
            } catch (err: any) { logger.error(`Error fetching country counts for room ${options.room}: ${err.message}\n${err.stack}`); return false; }
        }
    },
    "boss-startBattle":       { type: "fixed", constructNotification: async () => ({ title: 13593 }) },
    "boss-trailingCommunity": { type: "fixed", constructNotification: async () => ({ title: 13058 }) },
    "boss-leadingCommunity":  { type: "fixed", constructNotification: async () => ({ title: 13056 }) },
    "boss-onPointCommunity":  { type: "fixed", constructNotification: async () => ({ title: 13059 }) },
    "boss-numberOfPlayers": {
        type: "fixed",
        constructNotification: async (room: string, _state: any) => {
            try {
                const playerScores = await wdfScoring["boss"].getPlayerScores({ room });
                return { title: 13478, info: 13483, data: { NB_PLAYERS: { value: playerScores.length.toString() } } };
            } catch (err: any) { logger.error(`Error constructing boss-numberOfPlayers for room ${room}: ${err.message}\n${err.stack}`); return null; }
        }
    },
    "boss-communityLeader": {
        priority: 1, type: "reoccurring",
        constructNotification: async (room: string, _state: any) => {
            try {
                const playerScores = await wdfScoring["boss"].getPlayerScores({ room });
                const leader = playerScores[0];
                const dancerCardInfo = await wdfSessions.getPlayerInfo({ room, pids: leader ? [leader.pid] : [] });
                const notification: any = { title: 13480, info: 13481, data: {} };
                if (dancerCardInfo[0]) {
                    notification.data.PLAYER_ID  = { value: dancerCardInfo[0].name };
                    notification.data.nameSuffix  = { value: dancerCardInfo[0].nameSuffix.toString() };
                    notification.data.country     = { value: dancerCardInfo[0].country.toString() };
                    notification.data.avatar      = { value: dancerCardInfo[0].avatar.toString() };
                }
                return notification;
            } catch (err: any) { logger.error(`Error constructing boss-communityLeader for room ${room}: ${err.message}\n${err.stack}`); return null; }
        },
        canShow: async (options: any) => !options.state.firstNotificationGenerated
    },
    "spotlight-reward": {
        priority: 1, type: "reoccurring",
        constructNotification: (_room: string, state: any) => ({
            title: 13487, info: 13531, data: { REWARD: { value: state.currentTheme.themeData.reward.toString() } }
        })
    },
    "map-leader": {
        priority: 1, type: "reoccurring",
        constructNotification: async (room: string, _state: any) => {
            try {
                const playerScores = await wdfScoring["map"].getPlayerScores({ room });
                const leader = playerScores[0];
                const dancerCardInfo = await wdfSessions.getPlayerInfo({ room, pids: leader ? [leader.pid] : [] });
                const notification: any = { title: 13480, info: 13490, data: {} };
                if (dancerCardInfo[0]) {
                    notification.data.PLAYER_ID  = { value: dancerCardInfo[0].name };
                    notification.data.nameSuffix  = { value: dancerCardInfo[0].nameSuffix.toString() };
                    notification.data.country     = { value: dancerCardInfo[0].country.toString() };
                    notification.data.avatar      = { value: dancerCardInfo[0].avatar.toString() };
                }
                return notification;
            } catch (err: any) { logger.error(`Error constructing map-leader for room ${room}: ${err.message}\n${err.stack}`); return null; }
        }
    },
    "map-numberofPlayers": {
        priority: 1, type: "reoccurring",
        constructNotification: async (room: string, _state: any) => {
            try {
                const playerScores = await wdfScoring["map"].getPlayerScores({ room });
                return { title: 13482, info: 13491, data: { NB_PLAYERS: { value: playerScores.length.toString() } } };
            } catch (err: any) { logger.error(`Error constructing map-numberofPlayers for room ${room}: ${err.message}\n${err.stack}`); return null; }
        },
        canShow: async (options: any) => options.gameVersion === "jd2017"
    },
    "map-numberOfStars": {
        priority: 1, type: "reoccurring",
        constructNotification: async (_room: string, state: any) => ({
            title: 13492, info: 13494, data: { NB_STARS: { value: state.notificationsList["map-numberOfStars"].stars.toString() } }
        }),
        canShow: async (options: any) => {
            if (!options.room || !options.state) return null;
            if (!options.state.firstNotificationGenerated) return false;
            try {
                const scores = await wdfScoring["map"].getPlayerScores({ room: options.room });
                const stars = scores.reduce((s: number, e: any) => s + Math.floor((e.score * 13333) / 2000), 0);
                if (stars > 0) { options.state.notificationsList["map-numberOfStars"].stars = stars; return true; }
                return false;
            } catch (err: any) { logger.error(`Error in map-numberOfStars canShow for room ${options.room}: ${err.message}\n${err.stack}`); return false; }
        }
    },
    "map-localRank": {
        priority: 1, type: "reoccurring",
        constructNotification: async (room: string, _state: any) => {
            try {
                const numberOfPlayers = await wdfSessions.getNumberOfPlayers({ room });
                return { title: 13495, data: { NB_PLAYERS: { value: numberOfPlayers.toString() } } };
            } catch (err: any) { logger.error(`Error constructing map-localRank for room ${room}: ${err.message}\n${err.stack}`); return null; }
        }
    },
    "team-leader": {
        priority: 1, type: "reoccurring",
        constructNotification: async (room: string, state: any) => {
            const leader = state.notificationsList["team-leader"].leader;
            const team = state.currentTheme.themeData.teams[state.notificationsList["team-leader"].teamIndex];
            try {
                const dancerCardInfo = await wdfSessions.getPlayerInfo({ room, pids: leader ? [leader.pid] : [] });
                return {
                    title: 13480, info: 13508,
                    data: {
                        PLAYER_ID:  { value: dancerCardInfo[0]?.name || "" },
                        nameSuffix: { value: dancerCardInfo[0]?.nameSuffix?.toString() || "" },
                        country:    { value: dancerCardInfo[0]?.country?.toString() || "" },
                        avatar:     { value: dancerCardInfo[0]?.avatar?.toString() || "" },
                        TEAM:       { value: team }
                    }
                };
            } catch (err: any) { logger.error(`Error constructing team-leader for room ${room}: ${err.message}\n${err.stack}`); return null; }
        },
        canShow: async (options: any) => {
            const teamIndex = ((options.state.notificationsList["team-leader"].lastTeamIndex || 0) + 1) % options.state.currentTheme.themeData.teams.length;
            options.state.notificationsList["team-leader"].lastTeamIndex = teamIndex;
            try {
                const teamScores = await wdfScoring["teambattle"].getTeamScores({ room: options.room, team: options.state.currentTheme.themeData.teams[teamIndex] });
                if (teamScores.length > 0) { options.state.notificationsList["team-leader"].leader = teamScores[0]; options.state.notificationsList["team-leader"].teamIndex = teamIndex; return true; }
                return false;
            } catch (err: any) { logger.error(`Error in team-leader canShow for room ${options.room}: ${err.message}\n${err.stack}`); return false; }
        }
    },
    "team-numberOfStarsTotal": {
        priority: 1, type: "reoccurring",
        constructNotification: async (_room: string, state: any) => ({ title: 13492, info: 14286, data: { NB_STARS: { value: state.notificationsList["team-numberOfStarsTotal"].stars.toString() } } }),
        canShow: async (options: any) => {
            let stars = 0;
            try {
                for (const team of options.state.currentTheme.themeData.teams) {
                    const scores = await wdfScoring["teambattle"].getTeamScores({ room: options.room, team });
                    scores.forEach((e: any) => { stars += Math.floor((e.score * 13333) / 2000); });
                }
            } catch (err: any) { logger.error(`Error in team-numberOfStarsTotal canShow for room ${options.room}: ${err.message}\n${err.stack}`); return false; }
            if (stars > 0) { options.state.notificationsList["team-numberOfStarsTotal"].stars = stars; return true; }
            return false;
        }
    },
    "team-leadingTeam": { priority: 1, type: "reoccurring", constructNotification: async () => ({ title: 14284, info: 14285 }) },
    "team-numberOfStars": {
        priority: 1, type: "reoccurring",
        constructNotification: async (_room: string, state: any) => ({
            title: 13492, info: 14509,
            data: { NB_STARS: { value: state.notificationsList["team-numberOfStars"].stars.toString() }, TEAM: { value: state.currentTheme.themeData.teams[state.notificationsList["team-numberOfStars"].teamIndex].toString() } }
        }),
        canShow: async (options: any) => {
            const teamIndex = ((options.state.notificationsList["team-leader"].lastTeamIndex || 0) + 1) % options.state.currentTheme.themeData.teams.length;
            options.state.notificationsList["team-numberOfStars"].lastTeamIndex = teamIndex;
            try {
                const teamScores = await wdfScoring["teambattle"].getTeamScores({ room: options.room, team: options.state.currentTheme.themeData.teams[teamIndex] });
                const stars = teamScores.reduce((s: number, e: any) => s + Math.floor((e.score * 13333) / 2000), 0);
                if (stars > 0) { options.state.notificationsList["team-numberOfStars"].stars = stars; options.state.notificationsList["team-numberOfStars"].teamIndex = teamIndex; return true; }
                return false;
            } catch (err: any) { logger.error(`Error in team-numberOfStars canShow for room ${options.room}: ${err.message}\n${err.stack}`); return false; }
        }
    },
    "team-numberOfPlayers": {
        priority: 1, type: "reoccurring",
        constructNotification: async (room: string, _state: any) => {
            try {
                const numberOfPlayers = await wdfSessions.getNumberOfPlayers({ room });
                return { title: 13482, info: 13491, data: { NB_PLAYERS: { value: numberOfPlayers.toString() } } };
            } catch (err: any) { logger.error(`Error constructing team-numberOfPlayers for room ${room}: ${err.message}\n${err.stack}`); return false; }
        }
    },
    "tournament-leaderOfCompetition": {
        priority: 1, type: "reoccurring",
        constructNotification: async (room: string, state: any) => {
            try {
                let leader: any;
                if (state.currentTheme.themeData.roundNumber > 1) leader = (await wdfScoring["tournament"].getTournamentScores({ room }))[0];
                else leader = (await wdfScoring["tournament"].getPlayerScores({ room }))[0];
                const dancerCardInfo = await wdfSessions.getPlayerInfo({ room, pids: leader ? [leader.pid] : [] });
                const notification: any = { title: 13480, info: 13489, data: {} };
                if (dancerCardInfo[0]) {
                    notification.data.PLAYER_ID  = { value: dancerCardInfo[0].name };
                    notification.data.nameSuffix  = { value: dancerCardInfo[0].nameSuffix.toString() };
                    notification.data.country     = { value: dancerCardInfo[0].country.toString() };
                    notification.data.avatar      = { value: dancerCardInfo[0].avatar.toString() };
                }
                return notification;
            } catch (err: any) { logger.error(`Error constructing tournament-leaderOfCompetition for room ${room}: ${err.message}\n${err.stack}`); return false; }
        }
    },
    "tournament-leaderOfTrack": {
        priority: 1, type: "reoccurring",
        constructNotification: async (room: string, _state: any) => {
            try {
                const leader = (await wdfScoring["tournament"].getPlayerScores({ room }))[0];
                const dancerCardInfo = await wdfSessions.getPlayerInfo({ room, pids: leader ? [leader.pid] : [] });
                const notification: any = { title: 13480, info: 13490, data: {} };
                if (dancerCardInfo[0]) {
                    notification.data.PLAYER_ID  = { value: dancerCardInfo[0].name };
                    notification.data.nameSuffix  = { value: dancerCardInfo[0].nameSuffix.toString() };
                    notification.data.country     = { value: dancerCardInfo[0].country.toString() };
                    notification.data.avatar      = { value: dancerCardInfo[0].avatar.toString() };
                }
                return notification;
            } catch (err: any) { logger.error(`Error constructing tournament-leaderOfTrack for room ${room}: ${err.message}\n${err.stack}`); return null; }
        }
    },
    "tournament-reward": {
        priority: 1, type: "reoccurring",
        constructNotification: async (_room: string, state: any) => {
            const notification: any = { info: 13488 };
            switch (state.currentTheme.themeData.tournamentType) {
                case "ESWC": notification.title = 13630; break;
                case "weekly": notification.title = 13662; break;
                default: notification.title = 13487; notification.data = { REWARD: { value: 700 } }; break;
            }
            return notification;
        },
        canShow: async (options: any) => options.gameVersion === "jd2017"
    },
    "tournament-numberOfPlayers": {
        priority: 1, type: "reoccurring",
        constructNotification: async (room: string, _state: any) => {
            try {
                const playerScores = await wdfScoring["tournament"].getPlayerScores({ room });
                return { title: 13482, info: 13491, data: { NB_PLAYERS: { value: playerScores.length.toString() } } };
            } catch (err: any) { logger.error(`Error constructing tournament-numberOfPlayers for room ${room}: ${err.message}\n${err.stack}`); return null; }
        },
        canShow: async (options: any) => options.gameVersion === "jd2017"
    },
    "tournament-numberOfStarsTrack": {
        priority: 1, type: "reoccurring",
        constructNotification: async (_room: string, state: any) => ({ title: 13492, info: 13494, data: { NB_STARS: { value: state.notificationsList["tournament-numberOfStarsTrack"].stars.toString() } } }),
        canShow: async (options: any) => {
            try {
                const playerScores = await wdfScoring["tournament"].getPlayerScores({ room: options.room });
                if (!options.state.firstNotificationGenerated) return false;
                const stars = playerScores.reduce((s: number, e: any) => s + Math.floor((e.score * 13333) / 2000), 0);
                if (stars > 0) { options.state.notificationsList["tournament-numberOfStarsTrack"].stars = stars; return true; }
                return false;
            } catch (err: any) { logger.error(`Error in tournament-numberOfStarsTrack canShow for room ${options.room}: ${err.message}\n${err.stack}`); return false; }
        }
    },
    "tournament-numberOfStarsCompetition": {
        priority: 1, type: "reoccurring",
        constructNotification: async (_room: string, state: any) => ({ title: 13492, info: 13493, data: { NB_STARS: { value: state.notificationsList["tournament-numberOfStarsCompetition"].stars.toString() } } }),
        canShow: async (options: any) => {
            if (!options.state.firstNotificationGenerated) return false;
            try {
                const tournamentScores = await wdfScoring["tournament"].getTournamentScores({ room: options.room });
                const stars = tournamentScores.reduce((s: number, e: any) => s + Math.floor((e.score * 13333) / 2000), 0);
                if (stars > 0) { options.state.notificationsList["tournament-numberOfStarsCompetition"].stars = stars; return true; }
                return false;
            } catch (err: any) { logger.error(`Error in tournament-numberOfStarsCompetition canShow for room ${options.room}: ${err.message}\n${err.stack}`); return false; }
        }
    },
    "tournament-localRank": {
        priority: 1, type: "reoccurring",
        constructNotification: async (room: string, _state: any) => {
            try {
                const numberOfPlayers = await wdfSessions.getNumberOfPlayers({ room });
                return { title: 13495, data: { NB_PLAYERS: { value: numberOfPlayers.toString() } } };
            } catch (err: any) { logger.error(`Error constructing tournament-localRank for room ${room}: ${err.message}\n${err.stack}`); return null; }
        }
    }
};

const reoccurringNotifications: Record<string, string[]> = {
    "common":      ["country", "nextTheme"],
    "boss":        ["boss-numberOfPlayers", "boss-communityLeader"],
    "spotlight":   ["spotlight-reward"],
    "map":         ["map-leader", "map-numberofPlayers", "map-numberOfStars"],
    "vote":        ["map-leader", "map-numberofPlayers", "map-numberOfStars"],
    "teambattle":  ["team-numberOfPlayers", "team-numberOfStars", "team-numberOfStarsTotal", "team-leader", "team-leadingTeam"],
    "tournament":  ["tournament-numberOfStarsCompetition", "tournament-reward", "tournament-numberOfStarsTrack", "tournament-numberOfPlayers", "tournament-leaderOfCompetition"]
};

const keys = {
    state:        (room: string) => `wdf:rooms:${room}:notificationState`,
    notification: (room: string) => `wdf:rooms:${room}:notification`
};

const getState = async (room: string): Promise<any> => {
    try {
        const reply = await (redis as any).get(keys.state(room));
        let state: any = {};
        try { state = JSON.parse(reply) || {}; } catch { state = {}; }
        return state;
    } catch (err: any) { logger.error(`Error fetching notifications state for room ${room}: ${err.message}\n${err.stack}`); return {}; }
};

const setState = async (options: any): Promise<void> => {
    try { await (redis as any).set(keys.state(options.room), JSON.stringify(options.state)); }
    catch (err: any) { logger.error(`Error setting notifications state for room ${options.room}: ${err.message}\n${err.stack}`); }
};

const constructReoccurringList = async (theme: string): Promise<Record<string, any>> => {
    const themeNotifications = reoccurringNotifications[theme] || [];
    if (!reoccurringNotifications[theme]) logger.warn(`Theme '${theme}' not found in reoccurringNotifications, using only common`);
    const all = themeNotifications.concat(reoccurringNotifications["common"]);
    const list: Record<string, any> = {};
    for (const entry of all) {
        list[entry] = { priority: notifications[entry].priority, type: notifications[entry].type, showCount: 0 };
    }
    return list;
};

export const pushNotifications = async (options: any): Promise<void> => {
    const tempNotificationList: Record<string, any> = {};
    try {
        for (const notifName of options.notifications) {
            if (!notifications[notifName]) throw new Error(`Notification ${notifName} does not exist!`);
            tempNotificationList[notifName] = { priority: notifications[notifName].priority, type: notifications[notifName].type, showCount: 0 };
        }
        const state = await getState(options.room);
        state.notificationsList = { ...state.notificationsList, ...tempNotificationList };
        await setState({ room: options.room, state });
    } catch (err: any) { logger.error(`Error pushing notifications for room ${options.room}: ${err.message}\n${err.stack}`); }
};

export const queueReset = async (options: any): Promise<void> => {
    try {
        const state = await getState(options.room);
        if (!state.queuedThemes) state.queuedThemes = [];

        const checkOptions = (): boolean => {
            if (options.theme === "spotlight" && (!options.themeData?.reward)) { logger.error(`Spotlight theme reset requires themeData with reward!`); return false; }
            if (options.theme === "teambattle" && (!Array.isArray(options.themeData?.teams))) { logger.error(`Team Battle theme reset requires themeData with teams!`); return false; }
            if (options.theme === "tournament" && !options.gameVersion) { logger.error(`Tournament theme reset requires gameVersion!`); return false; }
            return true;
        };

        if (!checkOptions()) return;
        state.queuedThemes.push({
            ingameStartTime: options.ingameStartTime,
            ingameEndTime: options.ingameEndTime,
            resetTime: options.ingameStartTime - WDF_NOTIFICATIONS_RESET_TIMEDIFF,
            theme: options.theme,
            themeData: options.themeData || {},
            lastInGameScreen: options.lastInGameScreen || false,
            gameVersion: options.gameVersion
        });
        await setState({ room: options.room, state });
    } catch (err: any) { logger.error(`Error queueing notifications reset for room ${options.room}: ${err.message}\n${err.stack}`); }
};

const clear = async (room: string): Promise<void> => {
    try { await (redis as any).del(keys.notification(room)); }
    catch (err: any) { logger.error(`Error clearing notification for room ${room}: ${err.message}\n${err.stack}`); }
};

const selectNotification = async (options: any): Promise<string | null> => {
    const notificationsList = options.state.notificationsList;
    const lastNotification  = options.state.lastNotification;
    const fixedNotificationList: string[] = [];
    const eligibleKeys: string[] = [];

    if (!notificationsList || Object.keys(notificationsList).length === 0) { logger.warn(`selectNotification: notificationsList is empty`); return null; }

    await Promise.all(Object.keys(notificationsList).map(async (key) => {
        if (key === lastNotification) return;
        const isFixed = notificationsList[key].type === "fixed";
        if (notifications[key]?.canShow) {
            try {
                const show = await notifications[key].canShow(options);
                if (show) { eligibleKeys.push(key); if (isFixed) fixedNotificationList.push(key); }
            } catch (err: any) { logger.error(`selectNotification: canShow error for ${key}: ${err.message}`); }
        } else {
            eligibleKeys.push(key); if (isFixed) fixedNotificationList.push(key);
        }
    }));

    if (fixedNotificationList.length > 0) return fixedNotificationList[Math.round(Math.random() * (fixedNotificationList.length - 1))];

    const reoccurringKeys = eligibleKeys.filter(key => notificationsList[key].type !== "fixed");
    if (reoccurringKeys.length === 0) return null;

    const lowestShowCount = notificationsList[reoccurringKeys.reduce((prev, curr) => notificationsList[prev].showCount < notificationsList[curr].showCount ? prev : curr)].showCount;
    const showCountList = reoccurringKeys.filter(key => notificationsList[key].showCount === lowestShowCount && key !== lastNotification);
    if (showCountList.length === 0) return null;

    const priority = notificationsList[showCountList.reduce((prev, curr) => notificationsList[prev].priority < notificationsList[curr].priority ? prev : curr)].priority;
    const priorityList = showCountList.filter(key => notificationsList[key].priority === priority);
    return priorityList[Math.round(Math.random() * (priorityList.length - 1))];
};

export const update = async (room: string, gameVersion: string): Promise<void> => {
    try {
        const state = await getState(room);
        if (!state.gameVersion) state.gameVersion = gameVersion;
        const now = Date.now() / 1000;

        if (state.queuedThemes?.[0] && now > state.queuedThemes[0].resetTime) {
            if (state.currentTheme?.ingameStartTime === state.queuedThemes[0].ingameStartTime && state.currentTheme?.theme === state.queuedThemes[0].theme) {
                state.queuedThemes.shift();
                await setState({ room, state });
            } else {
                await clear(room);
                state.currentTheme = state.queuedThemes[0];
                state.queuedThemes.shift();
                state.notificationsList = await constructReoccurringList(state.currentTheme.theme);
                state.nextNotificationComputeTime = state.currentTheme.ingameStartTime + startGenerateTime;
                state.penultimateNotificationGenerated = false;
                state.firstNotificationGenerated = false;
                logger.info(`[${room}] Notifications reset for theme ${state.currentTheme.theme}, next compute at ${state.nextNotificationComputeTime}`);
                await setState({ room, state });
            }
        }

        if (!state.currentTheme) return;
        if (now < state.currentTheme.ingameStartTime + startGenerateTime) return;

        if (now > state.currentTheme.ingameEndTime) {
            try {
                let storedNotif: any = await (redis as any).get(keys.notification(room));
                if (storedNotif) {
                    storedNotif = JSON.parse(storedNotif);
                    if (storedNotif.nextNotificationCallTime < now + 60) {
                        storedNotif.nextNotificationCallTime = now + 300;
                        await (redis as any).set(keys.notification(room), JSON.stringify(storedNotif));
                    }
                }
            } catch { /* ignore */ }
            return;
        }

        if (now < state.nextNotificationComputeTime) {
            try {
                let storedNotif: any = await (redis as any).get(keys.notification(room));
                if (storedNotif) {
                    storedNotif = JSON.parse(storedNotif);
                    if (storedNotif.nextNotificationCallTime < state.nextNotificationComputeTime) {
                        storedNotif.nextNotificationCallTime = state.nextNotificationComputeTime + WDF_NOTIFICATION_SHOW_DURATION;
                        await (redis as any).set(keys.notification(room), JSON.stringify(storedNotif));
                    }
                }
            } catch { /* ignore */ }
            return;
        }

        logger.info(`[${room}] Computing notification, now=${now}, nextComputeTime=${state.nextNotificationComputeTime}`);

        try {
            const selectedNotification = await selectNotification({ room, state, gameVersion: state.gameVersion });

            if (!selectedNotification) {
                state.nextNotificationComputeTime = now + WDF_NOTIFICATION_COMPUTE_DURATION;
                await (redis as any).set(keys.notification(room), JSON.stringify({ nextNotificationCallTime: state.nextNotificationComputeTime + WDF_NOTIFICATION_SHOW_DURATION, duration: WDF_NOTIFICATION_SHOW_DURATION }));
                await setState({ room, state });
                return;
            }

            if (notifications[selectedNotification].type === "fixed") delete state.notificationsList[selectedNotification];
            else state.notificationsList[selectedNotification].showCount = (state.notificationsList[selectedNotification].showCount || 0) + 1;

            const constructedNotification: any = await notifications[selectedNotification].constructNotification(room, state);

            if (constructedNotification) {
                constructedNotification.name = state.lastNotification = selectedNotification;
                if (["tournament-numberOfPlayers", "map-numberofPlayers", "boss-numberOfPlayers"].includes(constructedNotification.name)) {
                    constructedNotification.name = "team-numberOfPlayers";
                }
            } else {
                state.lastNotification = selectedNotification;
                state.nextNotificationComputeTime = now + WDF_NOTIFICATION_COMPUTE_DURATION;
                await (redis as any).set(keys.notification(room), JSON.stringify({ nextNotificationCallTime: state.nextNotificationComputeTime + WDF_NOTIFICATION_SHOW_DURATION, duration: WDF_NOTIFICATION_SHOW_DURATION }));
                await setState({ room, state });
                logger.warn(`[${room}] constructNotification returned null for ${selectedNotification}`);
                return;
            }

            if (!state.firstNotificationGenerated) {
                state.firstNotificationGenerated = true;
                state.nextNotificationComputeTime = now + WDF_NOTIFICATION_COMPUTE_DURATION;
                constructedNotification.nextNotificationCallTime = state.nextNotificationComputeTime + 10;
            } else if (now > state.currentTheme.ingameEndTime - WDF_NOTIFICATION_COMPUTE_DURATION * 2 && !state.penultimateNotificationGenerated) {
                state.nextNotificationComputeTime = state.currentTheme.ingameEndTime - WDF_NOTIFICATION_COMPUTE_DURATION;
                constructedNotification.nextNotificationCallTime = state.currentTheme.ingameEndTime - endBufferTime;
                state.penultimateNotificationGenerated = true;
            } else {
                state.nextNotificationComputeTime = now + WDF_NOTIFICATION_COMPUTE_DURATION;
                constructedNotification.nextNotificationCallTime = state.nextNotificationComputeTime + 10;
            }

            if (constructedNotification.nextNotificationCallTime > state.currentTheme.ingameEndTime) constructedNotification.nextNotificationCallTime = state.currentTheme.ingameEndTime;
            if (state.nextNotificationComputeTime > state.currentTheme.ingameEndTime) state.nextNotificationComputeTime = state.currentTheme.ingameEndTime;

            constructedNotification.duration = WDF_NOTIFICATION_SHOW_DURATION;
            if (constructedNotification.data) {
                for (const key of Object.keys(constructedNotification.data)) {
                    constructedNotification.data[key].__class = "NotificationValue";
                }
            }

            await (redis as any).set(keys.notification(room), JSON.stringify(constructedNotification));
            await setState({ room, state });
        } catch (err: any) {
            await setState({ room, state });
            throw err;
        }
    } catch (err: any) {
        logger.error(`Error updating notifications for room ${room}: ${err.message}\n${err.stack}`);
    }
};

export const getNotification = async (options: any): Promise<any> => {
    try {
        let value: any = await (redis as any).get(keys.notification(options.room));
        try { value = JSON.parse(value); } catch (err: any) { throw err; }
        const notification: any = { __class: "Notification", ...value };
        if (notification.title) notification.title = oasis.getLocalization(notification.title, options.language);
        if (notification.info)  notification.info  = oasis.getLocalization(notification.info, options.language);
        return notification;
    } catch (err: any) { logger.error(`Error fetching notification for room ${options.room}: ${err.message}\n${err.stack}`); return null; }
};

export const init = (clients: WdfClients): void => {
    wdfSessions    = clients.wdfSessions;
    wdfScoring     = clients.wdfScoring;
    wdfRoomManager = clients.wdfRoomManager;
};
