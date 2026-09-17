import { file } from "../../lib/cache";
import { createLogger } from "../../lib/logger";
import { client as redis } from "../../lib/redis";
import { WdfClients, WdfConfig } from "../../types/wdf";

const logger = createLogger({ service: "wdf/themes/tournament" });
const wdfConfig = file<{ config: WdfConfig }>("/data/config.json").config as any;

let wdfScoring: any;
let wdfScreens: any;
let wdfSongSelector: any;
let wdfNotifications: any;
let wdfStats: any;
let wdfSchedule: any;
let wdfSessions: any;

const weeklyTournamentWinnersKey = "wdf:weekly-tournament-winners";
const playlistSizeDefault = 3;
const screenSequence = ["tournament-presentation", "tournament-lobby", "in-game", "waiting-screen", "tournament-recap"];

export const initModule = (clients: WdfClients): void => {
    wdfScoring       = clients.wdfScoring;
    wdfScreens       = clients.wdfScreens;
    wdfSongSelector  = clients.wdfSongSelector;
    wdfNotifications = clients.wdfNotifications;
    wdfStats         = clients.wdfStats;
    wdfSchedule      = clients.wdfSchedule;
    wdfSessions      = clients.wdfSessions;
};

const addScreensForMap = (screens: any[], options: any): void => {
    for (const screenType of screenSequence) {
        const startTime = screens.length > 0 ? screens[screens.length - 1].endTime : options.startTime;
        const screenOptions: any = {
            roomConfigName: options.roomConfigName,
            roomGameVersion: options.roomGameVersion,
            tournamentType: options.tournamentType,
            tournamentLogo: options.tournamentLogo,
            startTime,
            mapName: options.mapName,
            roundNumber: options.roundNumber,
            playListSize: options.playListSize,
            rewards: options.rewards,
            theme: "tournament"
        };
        if (options.screenDurations?.[screenType])
            screenOptions.duration = options.screenDurations[screenType].duration;
        const screen = wdfScreens.create(screenType, screenOptions);
        if (screen) screens.push(screen);
    }
};

const getRewards = (state: any): void => {
    const tournamentType = state.tournamentType || "default";
    const rewards: any[] = [];
    switch (tournamentType) {
        case "ESWC":
            rewards.push({ type: "skin", value: state.skinId });
            break;
        case "weekly":
            rewards.push({ type: "badge", value: state.badgeId });
            rewards.push({ type: "mojo", value: 700 });
            break;
        case "happy-hour":
        case "default":
        default:
            rewards.push({ type: "skin", value: state.skinIdGold });
            rewards.push({ type: "skin", value: state.skinIdSilver });
            rewards.push({ type: "skin", value: state.skinIdBronze });
            rewards.push({ type: "mojo", value: 700 });
            break;
    }
    state.rewards = rewards;
};

export const init = async (options: any): Promise<void> => {
    const state = options.state;
    state.currentRound     = 0;
    state.generatedScreens = false;
    state.recapComputed    = false;
    state.resetRecap       = undefined;
    state.inGameScreen     = null;
    state.scoringStarted   = false;

    try {
        let playlist: any;

        if (state.playlist) {
            try {
                const cfg = file<any>("/data/config.json");
                if (cfg?.playlists) {
                    playlist = cfg.playlists[state.playlist];
                    if (!playlist) logger.warn(`[${options.room}] Scheduled playlist "${state.playlist}" not found`);
                    else logger.info(`[${options.room}] Using scheduled playlist: ${state.playlist}`);
                }
            } catch (configErr: any) {
                logger.warn(`[${options.room}] Error loading config for playlist: ${configErr.message}`);
            }
        }

        if (!playlist) {
            playlist = await wdfSongSelector.selectPlaylist({ room: options.room, theme: "tournament", shouldUpdatePlaylistHistory: true });
        }

        state.selectionRule = playlist;
        const mapList = await wdfSongSelector.generateMapList({ room: options.room, mapList: state.mapList, selectionRule: state.selectionRule });
        state.mapList         = mapList;
        state.tournamentType  = playlist.type || "default";
        state.tournamentLogo  = playlist.logoUrl || "";
        state.tournamentStartTime = options.lastScreenEndTime;
        state.playlistLength  = state.playlistLength || playlist.tournamentLength || playlistSizeDefault;

        if (state.playlistLength > mapList.length) throw new Error("Not enough maps in mapList for the requested playlistLength");

        getRewards(state);
        logger.info(`[${options.room}] Tournament (type: ${state.tournamentType}) initialized with ${state.playlistLength} maps`);
    } catch (err: any) {
        logger.error(`[${options.room}] wdfThemes::tournament::init()\nFailed: ${err.message}`);
        throw err;
    }
};

export const update = async (options: any): Promise<any[] | void> => {
    const state = options.state;

    if (!state.generatedScreens) {
        const startTime = options.lastScreenEndTime;
        const screens: any[] = [];
        const playlistLength = state.playlistLength;
        state.currentRound = (state.currentRound || 0) + 1;

        if (state.currentRound > playlistLength) {
            state.generatedScreens = true;
            return;
        }

        let selectedMap: string;
        try {
            if (state.tournamentType === "ESWC" || state.selectionRule?.useAllMapsInOrder) {
                selectedMap = state.mapList[state.currentRound - 1];
                await wdfSongSelector.updateMapHistory(options.room, selectedMap);
            } else {
                selectedMap = await wdfSongSelector.selectSong({
                    room: options.room,
                    mapList: state.mapList,
                    selectionRule: state.selectionRule,
                    shouldUpdateMapHistory: true,
                    skipMapHistory: state.selectionRule?.skipMapHistory
                });
                state.mapList = state.mapList.filter((m: string) => m !== selectedMap);
            }
        } catch (err: any) {
            logger.error(`[${options.room}] wdfThemes::tournament::update()\nFailed to select map: ${err.message}`);
            throw err;
        }

        try {
            state.mapName = selectedMap;
            addScreensForMap(screens, {
                roomConfigName: state.roomConfigName,
                roomGameVersion: state.roomGameVersion,
                tournamentType: state.tournamentType || "default",
                tournamentLogo: state.tournamentLogo || "",
                startTime,
                screenDurations: state.screenDurations || null,
                mapName: selectedMap,
                playListSize: playlistLength,
                roundNumber: state.currentRound,
                rewards: state.rewards
            });

            for (const screen of screens) {
                if (screen?.type === "in-game") {
                    state.inGameScreen = { startTime: screen.startTime, endTime: screen.endTime };
                }
            }

            await wdfNotifications.queueReset({
                room: options.room,
                ingameStartTime: state.inGameScreen.startTime,
                ingameEndTime:   state.inGameScreen.endTime,
                theme: state.type,
                lastInGameScreen: state.currentRound === playlistLength,
                gameVersion: state.roomGameVersion,
                themeData: { tournamentType: state.tournamentType || "default", roundNumber: state.currentRound }
            });

            state.generatedScreens = true;
            state.recapComputed    = false;
            if (state.currentRound === playlistLength) screens.push(null);
            return screens;
        } catch (err: any) {
            logger.error(`[${options.room}] wdfThemes::tournament::update()\nFailed to generate screens: ${err.message}`);
            throw err;
        }
    } else {
        const now = Date.now() / 1000;

        if (state.currentRound === 1 && !state.scoringStarted && state.inGameScreen && now >= state.inGameScreen.startTime) {
            try {
                await wdfScoring.tournament.cleanUp(options);
                state.scoringStarted = true;
            } catch (err: any) {
                logger.error(`[${options.room}] wdfThemes::tournament::update()\nFailed to clean up: ${err.message}`);
                throw err;
            }
        }

        if (state.inGameScreen && !state.resetRecap && !state.recapComputed && now > state.inGameScreen.startTime) {
            try {
                await wdfScoring.tournament.resetComputeRecap(options);
                state.resetRecap = true;
            } catch (err: any) {
                logger.error(`[${options.room}] wdfThemes::tournament::update()\nFailed to reset recap: ${err.message}`);
                throw err;
            }
        }

        if (state.inGameScreen && now > state.inGameScreen.endTime + wdfConfig.defaultDurations.WDF_DELAY_TOLERANCE_LIMIT && !state.recapComputed) {
            try {
                await wdfScoring.tournament.computeRecap(options);
                state.recapComputed = true;
                if (state.currentRound < state.playlistLength) state.generatedScreens = false;
                state.resetRecap = false;
            } catch (err: any) {
                logger.error(`[${options.room}] wdfThemes::tournament::update()\nFailed to compute recap: ${err.message}`);
                throw err;
            }
        }
    }
};

export const start = async (options: any): Promise<void> => {
    options.state.themeStartTime = options.lastScreenEndTime;
    options.state.scoringStarted = false;
    try {
        await wdfScoring.tournament.start(options);
    } catch (err: any) {
        logger.error(`[${options.room}] wdfThemes::tournament::start()\nFailed: ${err.message}`);
        throw err;
    }
};

export const stop = async (options: any): Promise<void> => {
    const state = options.state;
    if (!state.recapComputed) {
        try {
            await wdfScoring.tournament.computeRecap(options);
            state.recapComputed = true;
        } catch (err: any) {
            logger.error(`[${options.room}] wdfThemes::tournament::stop()\nFailed to compute final recap: ${err.message}`);
        }
    }

    let tournamentWinner: any;
    try {
        tournamentWinner = await wdfScoring.tournament.getTournamentWinner(options);
    } catch (err: any) {
        logger.error(`[${options.room}] wdfThemes::tournament::stop()\nFailed to get winner: ${err.message}`);
        throw err;
    }

    try {
        if (state.tournamentType === "weekly" && tournamentWinner) {
            const oneWeekFromNow = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
            await (redis as any).zAdd(weeklyTournamentWinnersKey, { score: oneWeekFromNow, value: tournamentWinner });
        }
    } catch (err: any) {
        logger.error(`[${options.room}] wdfThemes::tournament::stop()\nFailed to store weekly winner: ${err.message}`);
        throw err;
    }

    try {
        const stars = await wdfScoring.tournament.getStars({ room: options.room });
        await wdfStats.tournament.put(options.room, { stars, winner: tournamentWinner, tournamentType: state.tournamentType, roomGameVersion: state.roomGameVersion });
    } catch (err: any) {
        logger.error(`[${options.room}] wdfThemes::tournament::stop()\nFailed to store stats: ${err.message}`);
        throw err;
    }
};

export const updateScore = async (options: any): Promise<any> => {
    return wdfScoring.tournament.updateScore(options);
};

export const getScoreRecap = async (options: any): Promise<any> => {
    return wdfScoring.tournament.getRecap(options);
};

export const getScoreStatus = async (options: any): Promise<any> => {
    return wdfScoring.tournament.getScoreStatus(options);
};
