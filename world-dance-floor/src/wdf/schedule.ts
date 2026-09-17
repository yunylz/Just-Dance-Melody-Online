import later from "later";
import { file } from "../lib/cache";
import { client as redis } from "../lib/redis";
import { createLogger } from "../lib/logger";
import { WdfClients } from "../types/wdf";

const logger = createLogger({ service: "wdf/schedule" });

const EVENT_LEEWAY_MS = 4 * 60 * 1000;
const PLAYED_EVENTS = new Map<string, number>();

const themeHistoryLength = 1;
const bossHistoryLength  = 2;

const getThemeHistoryKey = (room: string) => `wdf:rooms:${room}:theme-history`;
const getBossHistoryKey  = (room: string) => `wdf:rooms:${room}:boss-history`;

const getThemeHistory = async (room: string): Promise<string[]> =>
    (await (redis as any).lRange(getThemeHistoryKey(room), 0, -1)) || [];

const updateThemeHistory = async (room: string, theme: string): Promise<void> => {
    const multi = (redis as any).multi();
    multi.lPush(getThemeHistoryKey(room), theme);
    multi.lTrim(getThemeHistoryKey(room), 0, themeHistoryLength - 1);
    await multi.exec();
};

const getBossHistory = async (room: string): Promise<string[]> =>
    (await (redis as any).lRange(getBossHistoryKey(room), 0, -1)) || [];

const updateBossHistory = async (room: string, boss: string): Promise<void> => {
    const multi = (redis as any).multi();
    multi.lPush(getBossHistoryKey(room), boss);
    multi.lTrim(getBossHistoryKey(room), 0, bossHistoryLength - 1);
    await multi.exec();
};

const getScheduleKey = (scheduleEvent: any, room: string): string | null => {
    if (scheduleEvent.type === "probability") return null;
    return `${room}:${scheduleEvent.id}:${scheduleEvent.theme}`;
};

export const markAsPlayed = (scheduleEvent: any, room: string, time = Date.now()): void => {
    const key = getScheduleKey(scheduleEvent, room);
    if (key) PLAYED_EVENTS.set(key, time);
};

export const clearEvents = (): void => { PLAYED_EVENTS.clear(); };

const hasBeenPlayed = (scheduleEvent: any, room: string, time: number): boolean => {
    const key = getScheduleKey(scheduleEvent, room);
    if (!key) return false;
    const lastPlayed = PLAYED_EVENTS.get(key);
    if (!lastPlayed) return false;
    return Math.abs(lastPlayed - time) < EVENT_LEEWAY_MS;
};

const buildLaterSchedule = (recurrence: any): any => {
    switch (recurrence.type) {
        case "daily":
            return later.parse.recur().on(recurrence.hour).hour().on(recurrence.minute || 0).minute().on(recurrence.second || 0).second();
        case "weekly":
            return later.parse.recur().on(recurrence.day).dayOfWeek().on(recurrence.hour).hour().on(recurrence.minute || 0).minute().on(recurrence.second || 0).second();
        case "monthly":
            return later.parse.recur().on(recurrence.day).dayOfMonth().on(recurrence.hour).hour().on(recurrence.minute || 0).minute().on(recurrence.second || 0).second();
        case "yearly":
            return later.parse.recur().on(recurrence.month).month().on(recurrence.day).dayOfMonth().on(recurrence.hour).hour().on(recurrence.minute || 0).minute().on(recurrence.second || 0).second();
        default:
            return null;
    }
};

const calculateNextOccurrence = (scheduleEvent: any, time = Date.now()): number | null => {
    if (scheduleEvent.type !== "recurring") return null;
    const schedule = buildLaterSchedule(scheduleEvent.recurrence);
    if (!schedule) return null;
    const next = later.schedule(schedule).next(1, new Date(time));
    return next ? (next as Date).getTime() : null;
};

const shouldTriggerEvent = (scheduleEvent: any, time = Date.now()): boolean => {
    const schedule = buildLaterSchedule(scheduleEvent.recurrence);
    if (!schedule) return false;
    const laterSchedule = later.schedule(schedule);
    const prevOccurrence = laterSchedule.prev(1, new Date(time));
    const nextOccurrence = laterSchedule.next(1, new Date(time));
    let shouldTrigger = false;
    if (prevOccurrence) {
        const prevDiff = time - (prevOccurrence as Date).getTime();
        if (prevDiff >= 0 && prevDiff <= EVENT_LEEWAY_MS) shouldTrigger = true;
    }
    if (nextOccurrence && !shouldTrigger) {
        const nextDiff = (nextOccurrence as Date).getTime() - time;
        if (nextDiff >= 0 && nextDiff <= EVENT_LEEWAY_MS) shouldTrigger = true;
    }
    const prevStr = prevOccurrence ? (prevOccurrence as Date).toISOString() : "null";
    const nextStr = nextOccurrence ? (nextOccurrence as Date).toISOString() : "null";
    logger.info(`Event: ${scheduleEvent.id}, time: ${new Date(time).toISOString()}, prev: ${prevStr}, next: ${nextStr}, shouldTrigger: ${shouldTrigger}`);
    return shouldTrigger;
};

const getPrevOccurrenceTime = (scheduleEvent: any, time = Date.now()): number | null => {
    const schedule = buildLaterSchedule(scheduleEvent.recurrence);
    if (!schedule) return null;
    const prev = later.schedule(schedule).prev(1, new Date(time));
    return prev ? (prev as Date).getTime() : null;
};

const getTriggeredEvents = (schedule: any[], room: string, time = Date.now()): any[] => {
    return schedule
        .filter(e => e.type === "recurring")
        .filter(e => e.rooms?.includes(room))
        .filter(e => {
            if (!shouldTriggerEvent(e, time)) return false;
            const occurrenceTime = getPrevOccurrenceTime(e, time);
            return !hasBeenPlayed(e, room, occurrenceTime!);
        });
};

const selectFromProbability = (probabilities: Record<string, number>): string | null => {
    const themes = Object.keys(probabilities).filter(t => probabilities[t] > 0);
    if (themes.length === 0) return null;
    const totalWeight = themes.reduce((s, t) => s + probabilities[t], 0);
    let random = Math.random() * totalWeight;
    for (const theme of themes) { random -= probabilities[theme]; if (random <= 0) return theme; }
    return themes[themes.length - 1];
};

export const selectTheme = async (room: string, time = Date.now(), autoMarkAsPlayed = true): Promise<any> => {
    const schedule = file<any>("/data/schedule.json").schedule;
    const history  = await getThemeHistory(room);
    const timeMs   = time < 1000000000000 ? time * 1000 : time;

    const triggeredEvents = getTriggeredEvents(schedule, room, timeMs);
    if (triggeredEvents.length > 0) {
        const event = triggeredEvents[0];
        const occurrenceTime = getPrevOccurrenceTime(event, timeMs);
        if (autoMarkAsPlayed) markAsPlayed(event, room, occurrenceTime!);
        logger.info(`RECURRING EVENT TRIGGERED! Room: ${room}, Event: ${event.id}, Theme: ${event.theme}`);
        return { theme: event.theme, playlist: event.playlist || "default", schedule: event, occurrenceTime: time, source: "recurring" };
    }

    let roomProbabilities = schedule.filter((e: any) => e.type === "probability" && e.rooms.includes(room));
    for (let i = roomProbabilities.length - 1; i >= 0; i--) {
        if (history.includes(roomProbabilities[i].theme)) roomProbabilities.splice(i, 1);
    }

    if (roomProbabilities.length === 0) return { theme: "vote", playlist: null, source: "fallback", schedule, occurrenceTime: time };

    const probabilities: Record<string, number> = {};
    for (const e of roomProbabilities) probabilities[e.theme] = e.probability;
    const theme = selectFromProbability(probabilities);
    if (theme !== "vote") await updateThemeHistory(room, theme!);
    return { theme, playlist: null, source: "probability", schedule, occurrenceTime: time };
};

export const selectBoss = async (room: string): Promise<string | null> => {
    const history = await getBossHistory(room);
    const bosses  = file<any>("/data/bosses.json").bosses;
    const available = Object.keys(bosses).filter(b => !history.includes(b));
    if (available.length === 0) return null;
    const selected = available[Math.floor(Math.random() * available.length)];
    await updateBossHistory(room, selected);
    return selected;
};

export const init = (_clients: WdfClients): void => { return; };
