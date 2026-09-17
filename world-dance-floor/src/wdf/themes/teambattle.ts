import { file } from "../../lib/cache";
import { createLogger } from "../../lib/logger";
import * as oasis from "../../lib/oasis";
import { WdfClients, WdfConfig } from "../../types/wdf";

const logger = createLogger({ service: "wdf/themes/teambattle" });
const wdfConfig = file<{ config: WdfConfig }>("/data/config.json").config as any;

let wdfScoring: any;
let wdfScreens: any;
let wdfSongSelector: any;
let wdfNotifications: any;

const teamNameDefaultLanguage = "en";
const screenSequence = ["teambattle-intro", "teambattle-lobby", "in-game", "waiting-screen", "teambattle-recap"];

export const initModule = (clients: WdfClients): void => {
    wdfScoring       = clients.wdfScoring;
    wdfScreens       = clients.wdfScreens;
    wdfSongSelector  = clients.wdfSongSelector;
    wdfNotifications = clients.wdfNotifications;
};

const addScreensForMap = (screens: any[], options: any): boolean => {
    for (const screenType of screenSequence) {
        const startTime = screens.length > 0 ? screens[screens.length - 1].endTime : options.startTime;
        const screenOptions: any = {
            roomConfigName: options.roomConfigName,
            roomGameVersion: options.roomGameVersion,
            startTime,
            mapName: options.mapName,
            theme: "teambattle",
            teams: options.teams,
            teamLocIds: options.teamLocIds
        };
        if (options.screenDurations?.[screenType])
            screenOptions.duration = options.screenDurations[screenType].duration;
        const screen = wdfScreens.create(screenType, screenOptions);
        if (screen) screens.push(screen);
    }
    return true;
};

export const init = async (options: any): Promise<void> => {
    const state = options.state;
    state.teamLocIds = [14554, 14555];

    if (!state.teams) {
        if (!Array.isArray(state.teamLocIds) || state.teamLocIds.length !== 2)
            throw new Error("Invalid or missing teamLocIds for teambattle theme");
        state.teams = state.teamLocIds.map((id: number) => oasis.getLocalization(String(id), teamNameDefaultLanguage));
    } else {
        if (!Array.isArray(state.teams) || state.teams.length !== 2)
            throw new Error("Invalid teams array for teambattle theme");
    }
};

export const update = async (options: any): Promise<any[] | void> => {
    const state = options.state;

    if (!state.screensGenerated) {
        const themeStartTime = options.lastScreenEndTime;
        const screens: any[] = [];
        let inGameScreen: any;

        const playlist = await wdfSongSelector.selectPlaylist({ room: options.room, theme: "teambattle", shouldUpdatePlaylistHistory: true });
        state.selectionRule = playlist;

        const mapList = await wdfSongSelector.generateMapList({ room: options.room, mapList: state.mapList, selectionRule: state.selectionRule });
        state.mapList = mapList;

        const selectedMap = await wdfSongSelector.selectSong({ room: options.room, mapList: state.mapList, selectionRule: state.selectionRule, shouldUpdateMapHistory: true });

        addScreensForMap(screens, {
            roomConfigName: state.roomConfigName,
            roomGameVersion: state.roomGameVersion,
            startTime: themeStartTime,
            screenDurations: state.screenDurations || null,
            mapName: selectedMap,
            teams: state.teams,
            teamLocIds: state.teamLocIds
        });

        for (const screen of screens) {
            if (screen?.type === "in-game") {
                state.scoringStartTime = screen.startTime;
                state.scoringEndTime   = screen.endTime + wdfConfig.defaultDurations.WDF_DELAY_TOLERANCE_LIMIT;
                state.mapStartTime     = screen.startTime;
                state.mapEndTime       = screen.endTime;
                inGameScreen = screen;
            }
        }

        state.mapName = selectedMap;
        screens.push(null);

        await wdfNotifications.queueReset({
            room: options.room,
            ingameStartTime: inGameScreen.startTime,
            ingameEndTime:   inGameScreen.endTime,
            lastInGameScreen: true,
            gameVersion: state.roomGameVersion,
            theme: state.type,
            themeData: { teams: state.teams }
        });

        state.screensGenerated = true;
        return screens;
    } else {
        const now = Date.now() / 1000;
        if (!state.scoringStartTime || now < state.scoringStartTime) return;
        if (!state.recapComputed) {
            if (now > state.scoringStartTime && now < state.scoringEndTime) {
                await wdfScoring.teambattle.update({ room: options.room, teams: state.teams });
            } else if (now > state.scoringEndTime) {
                await wdfScoring.teambattle.computeRecap({ room: options.room, teams: state.teams, state });
                state.recapComputed = true;
            }
        }
    }
};

export const start = async (options: any): Promise<any> => {
    return wdfScoring.teambattle.start(options);
};

export const stop = async (options: any): Promise<any> => {
    return wdfScoring.teambattle.cleanUp(options);
};

export const updateScore = async (options: any): Promise<any> => {
    return wdfScoring.teambattle.updateScore(options);
};

export const getScoreRecap = async (options: any): Promise<any> => {
    return wdfScoring.teambattle.getRecap(options);
};

export const getScoreStatus = async (options: any): Promise<any> => {
    return wdfScoring.teambattle.getScoreStatus(options);
};
