import asyncLib from "async";
import { file } from "../../lib/cache";
import { createLogger } from "../../lib/logger";
import { client as redis } from "../../lib/redis";
import { WdfClients, WdfConfig } from "../../types/wdf";

const logger = createLogger({ service: "wdf/themes/vote" });
const wdfConfig = file<{ config: WdfConfig }>("/data/config.json").config as any;

let wdfScoring: any;
let wdfScreens: any;
let wdfSongSelector: any;
let wdfNotifications: any;
let wdfStats: any;
let wdfSessions: any;

const screenSequence = ["vote-lobby", "in-game", "waiting-screen", "vote-recap"];

const computeVoteResults = async (options: any): Promise<any[]> => {
    const state = options.state;
    try {
        const multi = (redis as any).multi();
        for (const option of state.voteOptions) {
            multi.get("wdf:rooms:" + options.room + ":vote-option:" + option);
        }
        const results = await multi.exec();

        let totalVoteValue = 0;
        const votes: any[] = state.voteOptions.map((name: string, i: number) => {
            const val = parseInt(results[i] || "0", 10);
            totalVoteValue += val;
            return { name, value: val };
        });

        if (totalVoteValue === 0) { votes[0].value++; votes[1].value++; totalVoteValue += 2; }
        votes.sort((a, b) => b.value - a.value);
        for (let i = 0; i < votes.length; i++) votes[i].value = Math.round((votes[i].value / totalVoteValue) * 100);
        if (votes[0].value === votes[1].value) { votes[0].value++; votes[1].value--; }

        return votes;
    } catch (err: any) {
        logger.error(`[${options.room}] wdfThemes::vote::computeVoteResults()\n${err.message}\n${err.stack}`);
        throw err;
    }
};

const addScreensForWinningMap = (screens: any[], options: any): void => {
    for (const screenType of screenSequence) {
        const startTime = screens.length > 0 ? screens[screens.length - 1].endTime : options.startTime;
        const screenOptions: any = {
            roomConfigName: options.roomConfigName,
            roomGameVersion: options.roomGameVersion,
            theme: "vote",
            mapName: options.mapName,
            startTime
        };
        if (wdfConfig.screenDurations?.[screenType]) {
            if (screenType === "vote") {
                screenOptions.voteDuration = wdfConfig.screenDurations[screenType].voteDuration;
                screenOptions.waitBeforeVoteCompute = wdfConfig.screenDurations[screenType].waitBeforeVoteCompute;
            } else {
                screenOptions.duration = wdfConfig.screenDurations[screenType].duration;
            }
        }
        const screen = wdfScreens.create(screenType, screenOptions);
        if (screen) screens.push(screen);
        else logger.warn(`[${options.room}] wdfThemes::vote::addScreensForWinningMap()\nFailed to create screen for type: ${screenType}`);
    }
};

const chooseVoteOptions = async (options: any): Promise<string[]> => {
    try {
        const state = options.state;
        const playlist = await wdfSongSelector.selectPlaylist({ room: options.room, theme: "vote", shouldUpdatePlaylistHistory: true });
        state.selectionRule = playlist;
        const mapList = await wdfSongSelector.generateMapList({ room: options.room, mapList: state.mapList, selectionRule: state.selectionRule });
        state.mapList = mapList;

        const voteOptions: string[] = [];
        await asyncLib.timesSeries(2, async (_i: number) => {
            const selected = await wdfSongSelector.selectSong({ room: options.room, mapList: state.mapList, shouldUpdateMapHistory: true });
            voteOptions.push(selected);
        });
        return voteOptions;
    } catch (err: any) {
        logger.error(`[${options.room}] wdfThemes::vote::chooseVoteOptions()\n${err.message}\n${err.stack}`);
        throw err;
    }
};

export const init = async (options: any): Promise<void> => {
    const state = options.state;
    state.voteStartTime    = null;
    state.generatedScreens = false;

    if (!options.room) { logger.error(`wdfThemes::vote::init() called without room!`); return; }

    try {
        if (!state.voteOptions) {
            logger.info(`[${options.room}] Choosing vote options...`);
            state.voteOptions = await chooseVoteOptions({ room: options.room, state });
        }
    } catch (err: any) {
        logger.error(`[${options.room}] wdfThemes::vote::init()\n${err.message}\n${err.stack}`);
        throw err;
    }
};

const cleanUp = async (options: any): Promise<void> => {
    const state = options.state;
    const multi = (redis as any).multi();
    if (state.voteOptions) {
        for (const option of state.voteOptions) multi.del("wdf:rooms:" + options.room + ":vote-option:" + option);
        multi.del("wdf:rooms:" + options.room + ":vote-result");
    }
    try {
        await multi.exec();
        await wdfScoring.map.cleanUp(options);
    } catch (err: any) {
        logger.error(`[${options.room}] wdfThemes::vote::cleanUp()\n${err.message}\n${err.stack}`);
        throw err;
    }
};

export const update = async (options: any): Promise<any[]> => {
    const state = options.state;
    if (!state.voteOptions) { logger.error(`[${options.room}] vote::update() called without voteOptions!`); return [null]; }

    if (!state.voteStartTime) {
        const screen = wdfScreens.create("vote", { roomConfigName: state.roomConfigName, startTime: options.lastScreenEndTime, theme: "vote", voteOptions: state.voteOptions });
        logger.success(`[${options.room}] Created vote screen with options: ${JSON.stringify(state.voteOptions)}`);
        state.voteStartTime        = screen.voteInfo.voteStartTime;
        state.voteEndTime          = screen.voteInfo.voteEndTime;
        state.voteComputeTime      = screen.voteInfo.voteComputeTime;
        state.voteResultFetchTime  = screen.voteInfo.voteResultFetchTime;
        delete screen.voteInfo.voteComputeTime;
        return [screen];
    }

    const now = Date.now() / 1000;
    if (now < state.voteComputeTime) return [];

    if (!state.generatedScreens) {
        try {
            const voteComputeStartTime = Date.now() / 1000;
            const voteResult = await computeVoteResults(options);
            const winningMap = voteResult[0].name;
            state.winningMap  = winningMap;
            state.voteResult  = voteResult;

            await (redis as any).set("wdf:rooms:" + options.room + ":vote-result", JSON.stringify(voteResult));

            const voteComputeFinishTime = Date.now() / 1000;
            if (voteComputeFinishTime >= state.voteResultFetchTime) {
                logger.warn(`[${options.room}] Vote computation took too long (${voteComputeFinishTime - voteComputeStartTime}s)!`);
            }

            await wdfSongSelector.updateMapHistory(options.room, winningMap);

            const screens: any[] = [];
            addScreensForWinningMap(screens, { room: options.room, roomConfigName: state.roomConfigName, roomGameVersion: state.roomGameVersion, mapName: winningMap, startTime: options.lastScreenEndTime });

            state.generatedScreens = true;
            let inGameScreen: any;
            for (const screen of screens) { if (screen.type === "in-game") inGameScreen = screen; }
            screens.push(null);

            state.scoreComputeTime = inGameScreen.endTime + wdfConfig.defaultDurations.WDF_DELAY_TOLERANCE_LIMIT;
            state.mapStartTime     = inGameScreen.startTime;
            state.mapEndTime       = inGameScreen.endTime;

            try {
                await wdfNotifications.queueReset({ room: options.room, ingameStartTime: inGameScreen.startTime, ingameEndTime: inGameScreen.endTime, gameVersion: state.roomGameVersion, theme: state.type, lastInGameScreen: true });
            } catch (err: any) {
                logger.error(`[${options.room}] vote::update() Error queueing notification reset: ${err.message}`);
                throw err;
            }
            return screens;
        } catch (err: any) {
            logger.error(`[${options.room}] vote::update() Error generating screens: ${err.message}`);
            throw err;
        }
    } else {
        if (!state.recapComputed && now >= state.scoreComputeTime) {
            try {
                await wdfScoring.map.computeRecap(options);
                state.recapComputed = true;
            } catch (err: any) {
                logger.error(`[${options.room}] vote::update() Error computing recap: ${err.message}`);
                throw err;
            }
            try {
                const stars = await wdfScoring.map.getStars({ room: options.room });
                await wdfStats.vote.put(options.room, { stars, mapName: state.winningMap });
            } catch (err: any) {
                logger.error(`[${options.room}] vote::update() Error updating stats: ${err.message}`);
                throw err;
            }
        }
    }
    return [];
};

export const start = async (options: any): Promise<void> => {
    options.state.themeStartTime = options.lastScreenEndTime;
    try {
        return cleanUp(options);
    } catch (err: any) {
        logger.error(`[${options.room}] vote::start() Error: ${err.message}\n${err.stack}`);
        throw err;
    }
};

export const stop = cleanUp;

export const computeScoreRecap = async (options: any): Promise<any> => {
    try { return wdfScoring.map.computeRecap(options); }
    catch (err: any) { logger.error(`[${options.room}] vote::computeScoreRecap() ${err.message}`); throw err; }
};

export const updateScore = async (options: any): Promise<any> => {
    try { return wdfScoring.map.updateScore(options); }
    catch (err: any) { logger.error(`[${options.room}] vote::updateScore() ${err.message}`); throw err; }
};

export const getScoreRecap = async (options: any): Promise<any> => {
    try { return wdfScoring.map.getScoreRecap(options); }
    catch (err: any) { logger.error(`[${options.room}] vote::getScoreRecap() ${err.message}`); throw err; }
};

export const getScoreStatus = async (options: any): Promise<any> => {
    try { return wdfScoring.map.getScoreStatus(options); }
    catch (err: any) { logger.error(`[${options.room}] vote::getScoreStatus() ${err.message}`); throw err; }
};

export const initModule = (clients: WdfClients): void => {
    wdfScoring       = clients.wdfScoring;
    wdfScreens       = clients.wdfScreens;
    wdfSongSelector  = clients.wdfSongSelector;
    wdfNotifications = clients.wdfNotifications;
    wdfStats         = clients.wdfStats;
    wdfSessions      = clients.wdfSessions;
};
