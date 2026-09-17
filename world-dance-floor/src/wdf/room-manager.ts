import asyncLib from "async";
import { file } from "../lib/cache";
import { createLogger } from "../lib/logger";
import { client as redis } from "../lib/redis";
import { WdfClients } from "../types/wdf";

const logger = createLogger({ service: "wdf/room-manager" });
const wdfConfig = file<any>("/data/config.json").config as any;

let wdfNotifications: any;
let wdfSessions: any;
let wdfLeaderboard: any;
let wdfSchedule: any;
let wdfThemes: any;
let wdfScoring: any;

const roomIsUpdating = new Map<string, boolean>();

export const init = (clients: WdfClients): void => {
    wdfNotifications = clients.wdfNotifications;
    wdfSessions      = clients.wdfSessions;
    wdfLeaderboard   = clients.wdfLeaderboard;
    wdfSchedule      = clients.wdfSchedule;
    wdfThemes        = clients.wdfThemes;
    wdfScoring       = clients.wdfScoring;
};

const getRoomConfig = (roomName: string): any => {
    const rooms = file<any>("/data/rooms.json").rooms;
    const room = rooms.find((r: any) => r.roomName === roomName);
    return room?.config ?? null;
};

const getThemeConfig = (themeName: string): any => {
    const allThemeConfigs = file<any>("/data/config.json").themeConfigs;
    return allThemeConfigs[themeName] || null;
};

const getEnabledRooms = (): any[] => {
    const rooms = file<any>("/data/rooms.json").rooms;
    return rooms.filter((r: any) => r.enabled);
};

const selectTheme = async (options: any): Promise<any> => {
    const selectedThemeDetails = await wdfSchedule.selectTheme(options.room, Date.now(), true);
    let themeName: string = selectedThemeDetails.theme;

    if (!themeName || !getThemeConfig(themeName)) {
        logger.error(`[${options.room}] wdfRoomManager::selectTheme()\nFalling back to 'vote'`);
        themeName = "vote";
    }
    if (!wdfThemes[themeName]) {
        logger.error(`[${options.room}] wdfRoomManager::selectTheme()\nTheme implementation for '${themeName}' not found, falling back to 'vote'`);
        themeName = "vote";
    }

    const themeConfig = getThemeConfig(themeName);
    const selectedTheme: any = {
        ...themeConfig,
        type: themeConfig.type,
        schedule: selectedThemeDetails.schedule,
        state: {
            ...themeConfig,
            themeConfigName: themeName,
            roomConfigName: options.room,
            roomGameVersion: options.roomGameVersion,
            type: themeName,
            playlist: selectedThemeDetails.playlist
        }
    };

    logger.info(`[${options.room}] Selected a theme: ${themeName}. Initializing...`);

    try {
        await wdfThemes[themeConfig.type].init({ room: options.room, state: selectedTheme.state, lastScreenEndTime: options.lastScreenEndTime });
    } catch (err: any) {
        logger.error(`[${options.room}] Error initializing theme ${selectedTheme.type}: ${err.message}\n${err.stack}`);
        throw err;
    }
    return selectedTheme;
};

const processThemeData = async (options: any): Promise<void> => {
    if (options.theme.finishedGeneratingScreens && options.screens?.length > 0) {
        logger.error(`[${options.room}] wdfRoomManager::processThemeData()\nTheme ${options.theme.type} has already finished generating screens.`);
        return;
    }
    try {
        const multi = (redis as any).multi();
        for (let i = 0; options.screens && i < options.screens.length; i++) {
            if (!options.screens[i]) {
                if (i !== options.screens.length - 1) logger.warn(`[${options.room}] wdfRoomManager::processThemeData()\nScreens after null`);
                if (i > 0) options.theme.endTime = options.screens[i - 1].endTime;
                else if (!options.theme.finishedGeneratingScreens) options.theme.endTime = options.lastScreenEndTime;
                options.theme.finishedGeneratingScreens = true;
                break;
            }
            options.themes.lastScreenEndTime = options.screens[i].endTime;
            multi.zAdd(options.screensKey, { score: options.screens[i].endTime, value: JSON.stringify(options.screens[i]) });
        }
        await multi.exec();
    } catch (err: any) {
        logger.error(`[${options.room}] wdfRoomManager::processThemeData()\n${err.message}\n${err.stack}`);
        throw err;
    }
};

const updateCurrentThemeStage = async (options: any): Promise<void> => {
    const stageActions: Record<string, (opts: any) => Promise<void>> = {
        initialized: async (opts) => {
            logger.info(`[${opts.room}] Starting theme ${opts.themes.current.type}`);
            await wdfThemes[opts.themes.current.type].start({ room: opts.room, lastScreenEndTime: opts.themes.lastScreenEndTime, state: opts.themes.current.state });
            opts.themes.current.stage = "started";
            logger.info(`[${opts.room}] Theme ${opts.themes.current.type} started`);
        },
        started: async (opts) => {
            try {
                const screens = await wdfThemes[opts.themes.current.type].update({ room: opts.room, lastScreenEndTime: opts.themes.lastScreenEndTime, state: opts.themes.current.state });
                await processThemeData({ lastScreenEndTime: opts.themes.lastScreenEndTime, screens, screensKey: opts.screensKey, theme: opts.themes.current, themes: opts.themes, room: opts.room });
                if (opts.themes.current.endTime && Date.now() / 1000 >= opts.themes.current.endTime) {
                    await wdfThemes[opts.themes.current.type].stop({ room: opts.room, state: opts.themes.current.state, lastScreenEndTime: opts.themes.lastScreenEndTime });
                    opts.themes.current.stage = "stopped";
                    logger.success(`[${opts.room}] Theme ${opts.themes.current.type} stopped.`);
                }
            } catch (err: any) { throw err; }
        },
        stopped: async (opts) => {
            logger.error(`[${opts.room}] wdfRoomManager::updateCurrentThemeStage()\nAttempted to stop stopped theme '${opts.themes.current.type}'`);
            throw new Error("theme switch did not happen after current theme was stopped");
        }
    };

    try {
        await stageActions[options.themes.current.stage](options);
    } catch (err: any) {
        logger.error(`[${options.room}] wdfRoomManager::updateCurrentThemeStage()\n${err.message}\n${err.stack}`);
        throw err;
    }
};

const updateNextThemeStage = async (options: any): Promise<void> => {
    try {
        if (!options.themes.next && options.themes.current.finishedGeneratingScreens) {
            const theme = await selectTheme({ ...options });
            options.themes.next = theme;
            options.themes.next.stage = "initialized";
            logger.info(`[${options.room}] Next theme selected: ${options.themes.next.type}`);
        }
        if (options.themes.next && !options.themes.next.finishedGeneratingScreens) {
            const screens = await wdfThemes[options.themes.next.type].update({ room: options.room, lastScreenEndTime: options.themes.lastScreenEndTime, state: options.themes.next.state });
            await processThemeData({ lastScreenEndTime: options.themes.lastScreenEndTime, screens, screensKey: options.screensKey, theme: options.themes.next, themes: options.themes, room: options.room });
        }
    } catch (err: any) {
        logger.error(`[${options.room}] wdfRoomManager::updateNextThemeStage()\n${err.message}\n${err.stack}`);
        throw err;
    }
};

const switchThemes = async (options: any): Promise<void> => {
    try {
        await wdfSessions.clean({ room: options.room });
        options.themes.current = options.themes.next;
        delete options.themes.next;
        await wdfThemes[options.themes.current.type].start({ room: options.room, lastScreenEndTime: options.lastScreenEndTime, state: options.themes.current.state });
        options.themes.current.stage = "started";
        logger.success(`[${options.room}] Switched to new theme: ${options.themes.current.type}`);
    } catch (err: any) {
        logger.error(`[${options.room}] wdfRoomManager::switchThemes()\n${err.message}\n${err.stack}`);
        throw err;
    }
};

const updateThemes = async (room: string): Promise<void> => {
    const themesKey  = `wdf:rooms:${room}:themes`;
    const screensKey = `wdf:rooms:${room}:screens`;
    const now = Date.now() / 1000;
    const roomConfig = getRoomConfig(room);
    if (!roomConfig) throw new Error(`No room config found for room '${room}'`);

    try {
        let themes: any = {};
        const value = await (redis as any).get(themesKey);
        if (value) themes = JSON.parse(value);

        let stateReset = false;
        if (!themes.lastScreenEndTime) { themes.lastScreenEndTime = now; stateReset = true; }
        else if (themes.lastScreenEndTime < now - wdfConfig.defaultDurations.WDF_STALE_SCREEN_TOLERANCE) {
            themes.lastScreenEndTime = now;
            delete themes.current; delete themes.next;
            logger.warn(`[${room}] Theme state was stale, resetting.`);
        }

        if (!themes.current) {
            logger.info(`[${room}] No current theme, selecting new theme`);
            const theme = await selectTheme({ room, roomConfig, roomConfigName: room, roomGameVersion: roomConfig.roomGameVersion, lastScreenEndTime: themes.lastScreenEndTime, stateReset });
            themes.current = theme;
            themes.current.stage = "initialized";
            logger.info(`[${room}] Selected current theme: ${themes.current.type}`);
        }

        await updateCurrentThemeStage({ room, themes, screensKey, roomConfig, roomConfigName: room, lastScreenEndTime: themes.lastScreenEndTime });
        await updateNextThemeStage({ room, themes, screensKey, roomConfig, roomConfigName: room, roomGameVersion: roomConfig.roomGameVersion, lastScreenEndTime: themes.lastScreenEndTime, stateReset });

        if (themes.current.stage === "stopped") {
            await switchThemes({ room, themes, lastScreenEndTime: themes.lastScreenEndTime });
        }

        await (redis as any).set(themesKey, JSON.stringify(themes));
        try { await (redis as any).zRemRangeByScore(screensKey, "-inf", now - wdfConfig.defaultDurations.WDF_SCREENS_HISTORY_DURATION); }
        catch (err: any) { logger.error(`[${room}] wdfRoomManager::updateThemes()\nError cleaning old screens: ${err.message}\n${err.stack}`); }
    } catch (err: any) {
        logger.error(`[${room}] wdfRoomManager::updateThemes()\n${err.message}\n${err.stack}`);
        throw err;
    }
};

const updateRoom = async (options: any): Promise<void> => {
    await asyncLib.parallel([
        async () => { await wdfNotifications.update(options.room, options.gameVersion); },
        async () => { await wdfSessions.update(options.room); },
        async () => { await wdfLeaderboard.update(options.room, getRoomConfig(options.room)); },
        async () => { await updateThemes(options.room); }
    ]);
};

export const update = async (options: any): Promise<void> => {
    const room = options.room;
    if (roomIsUpdating.get(room)) { logger.warn(`Room ${room} is already being updated, skipping`); return; }
    roomIsUpdating.set(room, true);
    try { await updateRoom(options); }
    catch (err: any) { logger.error(`Error updating room ${room}: ${err.message}\n${err.stack}`); }
    finally { roomIsUpdating.set(room, false); }
};

export const start = (options: any): void => {
    const intervalMs = options.intervalMs || 10000;
    setInterval(async () => {
        const rooms = file<any>("/data/rooms.json").rooms;
        if (!rooms?.length) { logger.warn("No rooms found to update"); return; }
        if (!rooms.some((r: any) => r.roomName === options.room)) { logger.warn(`Room ${options.room} not found`); return; }
        await update(options);
    }, intervalMs);
};

export const getCurrentThemeDetails = async (room: string): Promise<any> => {
    try {
        const raw = await (redis as any).get(`wdf:rooms:${room}:themes`);
        if (raw) {
            const themes = JSON.parse(raw);
            delete themes.current.state;
            return themes.current;
        }
        return null;
    } catch (err: any) { logger.error(`Error fetching current theme details for room ${room}: ${err.message}\n${err.stack}`); return null; }
};

export const getNextThemeDetails = async (room: string): Promise<any> => {
    try {
        const raw = await (redis as any).get(`wdf:rooms:${room}:themes`);
        if (raw) {
            const themes = JSON.parse(raw);
            if (themes.next) { delete themes.next.state; return themes.next; }
        }
        return null;
    } catch (err: any) { logger.error(`Error fetching next theme details for room ${room}: ${err.message}\n${err.stack}`); return null; }
};

export const forwardUpdateScores = async (options: any): Promise<any> => {
    return wdfThemes[options.type].updateScore(options);
};

export const forwardGetScoreRecap = async (options: any): Promise<any> => {
    return wdfThemes[options.type].getScoreRecap(options);
};

export const forwardGetScoreStatus = async (options: any): Promise<any> => {
    return wdfThemes[options.type].getScoreStatus(options);
};
