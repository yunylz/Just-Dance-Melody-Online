import async from "async";
import { file } from "../../lib/cache";
import { createLogger } from "../../lib/logger";
import { WdfClients, WdfConfig } from "../../types/wdf";

const logger = createLogger({ service: "wdf/themes/map" });
const wdfConfig = file<{ config: WdfConfig }>("/data/config.json").config as any;

const songdb = file<Record<string, any>>("/data/songdb.json");

let wdfScoring: any;
let wdfScreens: any;
let wdfSongSelector: any;
let wdfNotifications: any;

const maxPlaylistSizeDefault = 1;
const minPlaylistSizeDefault = 1;
const screenSequence = ["map-lobby", "in-game", "waiting-screen", "map-recap"];

const addScreensForMap = (screens: any[], options: any): void => {
    for (const screenType of screenSequence) {
        const startTime = screens.length > 0 ? screens[screens.length - 1].endTime : options.startTime;
        const screenOptions: any = {
            theme: "map",
            mapName: options.mapName,
            startTime,
            duration: wdfConfig.screenDurations[screenType]?.duration
        };
        const screen = wdfScreens.create(screenType, screenOptions);
        if (screen) screens.push(screen);
        else logger.warn(`Failed to create screen for type: ${screenType}`);
    }
};

export const init = async (options: any): Promise<void> => {
    const state = options.state;
    const playlist = await wdfSongSelector.selectPlaylist({ room: options.room, theme: "map", shouldUpdatePlaylistHistory: true });
    state.selectionRule = playlist;
    const mapList = await wdfSongSelector.generateMapList({ room: options.room, mapList: state.mapList, selectionRule: state.selectionRule });
    state.mapList = mapList;
};

export const update = async (options: any): Promise<any[]> => {
    const state = options.state;

    if (!state.generatedScreens) {
        const startTime = options.lastScreenEndTime;
        const screens: any[] = [];

        state.minPlaylistSize = Math.max(state.minPlaylistSize || minPlaylistSizeDefault, minPlaylistSizeDefault);
        state.maxPlaylistSize = Math.max(state.maxPlaylistSize || maxPlaylistSizeDefault, maxPlaylistSizeDefault);
        const playListSize = Math.ceil(Math.random() * Math.abs(state.maxPlaylistSize - state.minPlaylistSize)) + state.minPlaylistSize;

        await async.timesSeries(playListSize, async (i: number) => {
            const selectedMap = await wdfSongSelector.selectSong({ room: options.room });
            logger.info(`Selected map for playlist ${i}: ${selectedMap}`);
            if (!selectedMap) throw new Error("No valid map could be selected for map theme");
            addScreensForMap(screens, { startTime, mapName: selectedMap });
        });

        state.inGameScreens = [];
        state.resetComputeRecapTimestamp = [];

        for (const screen of screens) {
            if (screen.type === "in-game") {
                state.inGameScreens.push({ startTime: screen.startTime, endTime: screen.endTime });
                state.resetComputeRecapTimestamp.push(screen.startTime);
            }
        }

        for (const screen of state.inGameScreens) {
            await wdfNotifications.queueReset({
                room: options.room,
                ingameStartTime: screen.startTime,
                ingameEndTime:   screen.endTime,
                theme: state.type,
                lastInGameScreen: screen.endTime === state.inGameScreens[state.inGameScreens.length - 1].endTime
            });
        }

        logger.info(`Generated ${screens.length} screens for map theme`);
        state.generatedScreens = true;
        screens.push(null);
        return screens;
    } else {
        const now = Date.now() / 1000;

        if (state.resetComputeRecapTimestamp?.length > 0 && now > state.resetComputeRecapTimestamp[0] + 10) {
            await wdfScoring.map.resetComputeRecap(options);
            state.resetComputeRecapTimestamp.shift();
            return [];
        }

        if (state.inGameScreens?.length > 0 && now > state.inGameScreens[0].endTime + 5) {
            await wdfScoring.map.computeRecap(options);
            state.inGameScreens.shift();
            return [];
        }

        return [];
    }
};

export const start = async (_options: any): Promise<void> => { return; };

export const stop = async (options: any): Promise<any> => {
    return wdfScoring.map.cleanUp(options);
};

export const computeScoreRecap = async (options: any): Promise<any> => {
    return wdfScoring.map.computeRecap(options);
};

export const updateScore = async (options: any): Promise<any> => {
    return wdfScoring.map.updateScore(options);
};

export const getScoreRecap = async (options: any): Promise<any> => {
    logger.info(`[${options.room}] Getting score recap`);
    const reply = await wdfScoring.map.getRecap(options);
    logger.info(`[${options.room}] Got recap: ${JSON.stringify(reply)}`);
    return reply;
};

export const getScoreStatus = async (options: any): Promise<any> => {
    return wdfScoring.map.getScoreStatus(options);
};

export const initModule = (clients: WdfClients): void => {
    wdfScoring       = clients.wdfScoring;
    wdfScreens       = clients.wdfScreens;
    wdfSongSelector  = clients.wdfSongSelector;
    wdfNotifications = clients.wdfNotifications;
};
