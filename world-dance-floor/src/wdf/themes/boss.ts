import { file } from "../../lib/cache";
import { createLogger } from "../../lib/logger";
import { WdfClients, WdfConfig } from "../../types/wdf";

const logger = createLogger({ service: "wdf/themes/boss" });
const wdfConfig = file<{ config: WdfConfig }>("/data/config.json").config as any;

let wdfScoring: any;
let wdfScreens: any;
let wdfSessions: any;
let wdfSongSelector: any;
let wdfNotifications: any;
let wdfSchedule: any;

const minMaps = 1;
const maxMaps = 3;
const screenSequence = ["boss-intro", "boss-lobby", "in-game", "waiting-screen", "boss-recap"];

export const initModule = (clients: WdfClients): void => {
    wdfScoring       = clients.wdfScoring;
    wdfScreens       = clients.wdfScreens;
    wdfSessions      = clients.wdfSessions;
    wdfSongSelector  = clients.wdfSongSelector;
    wdfNotifications = clients.wdfNotifications;
    wdfSchedule      = clients.wdfSchedule;
};

const addScreensForMap = (screens: any[], options: any): boolean => {
    let screenStartTime = options.startTime;
    for (const screenType of screenSequence) {
        const screenOptions: any = {
            theme: "boss",
            mapName: options.mapName,
            startTime: screenStartTime,
            roomConfigName: options.roomConfigName,
            roomGameVersion: options.roomGameVersion,
            bossInfo: options.bossInfo
        };
        if (options.screenDurations?.[screenType])
            screenOptions.duration = options.screenDurations[screenType].duration;
        const screen = wdfScreens.create(screenType, screenOptions);
        if (screen) {
            screens.push(screen);
            screenStartTime = screen.endTime;
        }
    }
    return true;
};

const pushStartRoundNotifications = async (options: any): Promise<void> => {
    const state = options.state;
    const roundTarget = (state.bossState.bossMaxHealth / state.playlistLength) * (state.currentRound - 1);
    const startRoundNotifications: string[] = [];

    if (state.currentRound === 1) {
        startRoundNotifications.push("boss-startBattle");
    } else {
        if (state.bossState.previousRoundStars > roundTarget) {
            startRoundNotifications.push("boss-leadingCommunity");
        } else if (state.bossState.previousRoundStars > roundTarget * 0.8) {
            startRoundNotifications.push("boss-onPointCommunity");
        } else {
            startRoundNotifications.push("boss-trailingCommunity");
        }
    }

    try {
        await wdfNotifications.pushNotifications({ room: options.room, notifications: startRoundNotifications });
    } catch (err: any) {
        logger.error(`[${options.room}] wdfThemes::boss::pushStartRoundNotifications()\nFailed: ${err.message}`);
        throw err;
    }
};

export const init = async (options: any): Promise<void> => {
    const state = options.state;
    const bossDb = file<{ bosses: Record<string, any> }>("/data/bosses.json").bosses;
    const selectedBoss = await wdfSchedule.selectBoss(options.room);
    const boss = bossDb[selectedBoss];

    state.bossName = boss.bossId;
    if (boss.config) {
        state.bossDifficulty  = boss.config.bossDifficulty;
        state.playlistLength  = boss.config.playlistLength;
    } else {
        logger.error(`[${options.room}] Boss ${boss.bossId} has no config!`);
        state.bossDifficulty = 5;
        state.playlistLength = Math.floor(Math.random() * (maxMaps - minMaps + 1)) + minMaps;
    }

    if (!state.bossDifficulty || state.bossDifficulty < 1 || state.bossDifficulty > 6) state.bossDifficulty = 5;
    if (!state.bossName) throw new Error("No bossName provided for boss theme");
    if (!Object.prototype.hasOwnProperty.call(state, "playlistLength")) state.playlistLength = minMaps;
    if (state.playlistLength < minMaps) state.playlistLength = minMaps;
    if (state.playlistLength > maxMaps) state.playlistLength = maxMaps;

    try {
        const playlist = await wdfSongSelector.selectPlaylist({ room: options.room, theme: "boss", shouldUpdatePlaylistHistory: true });
        state.selectionRule = playlist;
        const mapList = await wdfSongSelector.generateMapList({ room: options.room, mapList: state.mapList, selectionRule: state.selectionRule });
        state.mapList = mapList;

        let numberOfPlayers = await wdfSessions.getNumberOfPlayers(options);
        if (!numberOfPlayers || numberOfPlayers < 1) numberOfPlayers = 1;
        const starsToWin = numberOfPlayers * state.bossDifficulty * state.playlistLength;
        options.state.currentRound = 0;
        options.state.bossState = { bossMaxHealth: starsToWin, bossHealth: starsToWin };
    } catch (err: any) {
        logger.error(`[${options.room}] wdfThemes::boss::init()\nFailed: ${err.message}`);
        throw err;
    }
};

export const update = async (options: any): Promise<any[] | void> => {
    const state = options.state;

    if (!state.screensGenerated) {
        const screens: any[] = [];

        if (state.bossState.bossHealth <= 0 || state.currentRound === state.playlistLength) {
            state.screensGenerated = true;
            if (state.currentRound !== state.playlistLength) screens.push(null);
            return screens;
        }

        state.currentRound++;
        let inGameScreen: any;

        const selectedMap = await wdfSongSelector.selectSong({ room: options.room, mapList: state.mapList, shouldUpdateMapHistory: true });
        state.mapName = selectedMap;

        addScreensForMap(screens, {
            startTime: options.lastScreenEndTime,
            mapName: selectedMap,
            roomConfigName: state.roomConfigName,
            roomGameVersion: state.roomGameVersion,
            bossInfo: { bossName: state.bossName, playlistLength: state.playlistLength, currentRound: state.currentRound },
            screenDurations: state.screenDurations || null
        });

        for (const screen of screens) {
            if (screen?.type === "in-game") {
                inGameScreen          = screen;
                state.scoringStartTime = screen.startTime;
                state.scoringEndTime   = screen.endTime;
                state.mapEndTime       = screen.endTime;
            }
        }

        state.screensGenerated  = true;
        state.resetComputeRecap = false;
        state.recapComputed     = false;

        try {
            await wdfNotifications.queueReset({
                room: options.room,
                ingameStartTime: inGameScreen.startTime,
                ingameEndTime:   inGameScreen.endTime,
                lastInGameScreen: state.currentRound >= state.playlistLength,
                gameVersion: state.roomGameVersion,
                theme: state.type,
            });
        } catch (err: any) {
            logger.error(`[${options.room}] wdfThemes::boss::update()\nFailed to queue reset: ${err.message}`);
            throw err;
        }

        if (state.currentRound === state.playlistLength) screens.push(null);
        return screens;
    } else {
        const now = Date.now() / 1000;

        if (now > state.scoringStartTime && now < state.scoringEndTime) {
            if (!state.resetComputeRecap && now > state.scoringStartTime + wdfConfig.defaultDurations.WDF_DELAY_TOLERANCE_LIMIT) {
                await wdfScoring.boss.resetComputeRecap(options);
                state.resetComputeRecap = true;
            }

            const numberOfPlayers = await wdfSessions.getNumberOfPlayers(options);
            options.state.onTimePlayers = numberOfPlayers;

            if (!state.notificationsPushed) {
                await pushStartRoundNotifications(options);
                state.notificationsPushed = true;
            }

            const bossState = await wdfScoring.boss.update(options);
            state.bossState = bossState;
            return;
        } else if (now > state.scoringEndTime && !state.recapComputed) {
            await wdfScoring.boss.computeRecap(options);
            state.recapComputed       = true;
            state.notificationsPushed = false;
            state.screensGenerated    = false;
            return;
        } else {
            return;
        }
    }
};

export const start = async (options: any): Promise<any> => {
    options.state.themeStartTime = options.lastScreenEndTime;
    return wdfScoring.boss.start(options);
};

export const stop = async (options: any): Promise<any> => {
    return wdfScoring.boss.cleanUp(options);
};

export const updateScore = async (options: any): Promise<any> => {
    return wdfScoring.boss.updateScore(options);
};

export const getScoreRecap = async (options: any): Promise<any> => {
    return wdfScoring.boss.getRecap(options);
};

export const getScoreStatus = async (options: any): Promise<any> => {
    return wdfScoring.boss.getScoreStatus(options);
};
