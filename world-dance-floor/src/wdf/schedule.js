/**
 * This modules is for scheduling logic!
 * 
 * Schedule automatically selects themes based on event schedules.
 * Picks an event randomly if there's no event scheduled.
 */

// External modules
const later = require("later");

// Internal modules
const cache = require("../lib/cache");
const redis = require("../lib/redis").client;
const logger = require("../lib/logger").createLogger({ service: "wdf/schedule" });


var EVENT_LEEWAY_MS = 4 * 60 * 1000; // 4 minutes
var PLAYED_EVENTS = new Map();

var themeHistoryLength = 1;
var bossHistoryLength = 2;

const getThemeHistoryKey = (room) => {
    return `wdf:rooms:${room}:theme-history`;
};

const getThemeHistory = async (room) => {
    var history = await redis.lRange(getThemeHistoryKey(room), 0, -1);
    return history || [];
};

const updateThemeHistory = async (room, theme) => {
    var redisKey = getThemeHistoryKey(room);

    var multi = redis.multi();
    multi.lPush(redisKey, theme);
    multi.lTrim(redisKey, 0, themeHistoryLength - 1);
    await multi.exec();
    return;
};

const getBossHistoryKey = (room) => {
    return `wdf:rooms:${room}:boss-history`;
};

const getBossHistory = async (room) => {
    var history = await redis.lRange(getBossHistoryKey(room), 0, -1);
    return history || [];
};

const updateBossHistory = async (room, boss) => {
    var redisKey = getBossHistoryKey(room);

    var multi = redis.multi();
    multi.lPush(redisKey, boss);
    multi.lTrim(redisKey, 0, bossHistoryLength - 1);
    await multi.exec();
    return;
};

const getScheduleKey = (scheduleEvent, room) => {
    if (scheduleEvent.type === "probability") {
        return null;
    }

    return `${room}:${scheduleEvent.id}:${scheduleEvent.theme}`;
};

const markAsPlayed = (scheduleEvent, room, time = Date.now()) => {
    const key = getScheduleKey(scheduleEvent, room);
    PLAYED_EVENTS.set(key, time);
};

const clearEvents = () => {
    PLAYED_EVENTS.clear();
};

const hasBeenPlayed = (scheduleEvent, room, time) => {
    const key = getScheduleKey(scheduleEvent, room);
    const lastPlayed = PLAYED_EVENTS.get(key);

    if (!lastPlayed) {
        return false;
    }

    return Math.abs(lastPlayed - time) < EVENT_LEEWAY_MS;
};

const calculateNextOccurrence = (scheduleEvent, time = Date.now()) => {
    if (scheduleEvent.type !== "recurring") {
        return null;
    }

    const recurrence = scheduleEvent.recurrence;
    const currentDate = new Date(time);

    let schedule;

    switch (recurrence.type) {
        case "daily":
            schedule = later.parse.recur()
            .on(recurrence.hour).hour()
            .on(recurrence.minute || 0).minute()
            .on(recurrence.second || 0).second();
            break;
        case "weekly":
            schedule = later.parse.recur()
            .on(recurrence.day).dayOfWeek()
            .on(recurrence.hour).hour()
            .on(recurrence.minute || 0).minute()
            .on(recurrence.second || 0).second();
            break;
        case "monthly":
            schedule = later.parse.recur()
            .on(recurrence.day).dayOfMonth()
            .on(recurrence.hour).hour()
            .on(recurrence.minute || 0).minute()
            .on(recurrence.second || 0).second();
            break;
        case "yearly":
            schedule = later.parse.recur()
            .on(recurrence.month).month()
            .on(recurrence.day).dayOfMonth()
            .on(recurrence.hour).hour()
            .on(recurrence.minute || 0).minute()
            .on(recurrence.second || 0).second();
            break;
        default:
            return null;
    }

    const next = later.schedule(schedule).next(1, currentDate);
    return next ? next.getTime() : null;
};

const shouldTriggerEvent = (scheduleEvent, time = Date.now()) => {
    // Get both the next and previous occurrence to handle edge cases
    const recurrence = scheduleEvent.recurrence;
    let schedule;

    switch (recurrence.type) {
        case "daily":
            schedule = later.parse.recur()
                .on(recurrence.hour).hour()
                .on(recurrence.minute || 0).minute()
                .on(recurrence.second || 0).second();
            break;
        case "weekly":
            schedule = later.parse.recur()
                .on(recurrence.day).dayOfWeek()
                .on(recurrence.hour).hour()
                .on(recurrence.minute || 0).minute()
                .on(recurrence.second || 0).second();
            break;
        default:
            return false;
    }

    const laterSchedule = later.schedule(schedule);
    const prevOccurrence = laterSchedule.prev(1, new Date(time));
    const nextOccurrence = laterSchedule.next(1, new Date(time));
    
    let shouldTrigger = false;
    let closestOccurrence = null;
    let timeDiff = Infinity;

    // Check if previous occurrence is within leeway
    if (prevOccurrence) {
        const prevDiff = time - prevOccurrence.getTime();
        if (prevDiff >= 0 && prevDiff <= EVENT_LEEWAY_MS) {
            shouldTrigger = true;
            closestOccurrence = prevOccurrence;
            timeDiff = prevDiff;
        }
    }

    // Check if next occurrence is within leeway (event about to happen)
    if (nextOccurrence && !shouldTrigger) {
        const nextDiff = nextOccurrence.getTime() - time;
        if (nextDiff >= 0 && nextDiff <= EVENT_LEEWAY_MS) {
            shouldTrigger = true;
            closestOccurrence = nextOccurrence;
            timeDiff = -nextDiff; // negative to show it's in the future
        }
    }
    
    // Debug logging
    const prevStr = prevOccurrence ? prevOccurrence.toISOString() : 'null';
    const nextStr = nextOccurrence ? nextOccurrence.toISOString() : 'null';
    logger.info(`Event: ${scheduleEvent.id}, time: ${new Date(time).toISOString()}, prev: ${prevStr}, next: ${nextStr}, shouldTrigger: ${shouldTrigger}`);
    
    return shouldTrigger;
};

// Helper to get the previous occurrence time for a recurring event
const getPrevOccurrenceTime = (scheduleEvent, time = Date.now()) => {
    const recurrence = scheduleEvent.recurrence;
    let schedule;

    switch (recurrence.type) {
        case "daily":
            schedule = later.parse.recur()
                .on(recurrence.hour).hour()
                .on(recurrence.minute || 0).minute()
                .on(recurrence.second || 0).second();
            break;
        case "weekly":
            schedule = later.parse.recur()
                .on(recurrence.day).dayOfWeek()
                .on(recurrence.hour).hour()
                .on(recurrence.minute || 0).minute()
                .on(recurrence.second || 0).second();
            break;
        default:
            return null;
    }

    const prev = later.schedule(schedule).prev(1, new Date(time));
    return prev ? prev.getTime() : null;
};

const getTriggeredEvents = (schedule, room, time = Date.now()) => {
    return schedule
        .filter(sEvent => sEvent.type === "recurring")
        .filter(sEvent => sEvent.rooms && sEvent.rooms.includes(room))
        .filter(sEvent => {
            if (!shouldTriggerEvent(sEvent, time)) {
                return false;
            }

            const occurrenceTime = getPrevOccurrenceTime(sEvent, time);
            return !hasBeenPlayed(sEvent, room, occurrenceTime);
        });
};

const selectFromProbability = (probabilities) => {
    const themes = Object.keys(probabilities).filter(
        theme => probabilities[theme] > 0
    );

    if (themes.length === 0) {
        return null;
    }

    const totalWeight = themes.reduce(
        (sum, theme) => sum + probabilities[theme], 0
    );

    let random = Math.random() * totalWeight;

    for (const theme of themes) {
        random -= probabilities[theme];
        if (random <= 0) {
            return theme;
        }
    }

    return themes[themes.length - 1];
};

const selectTheme = async (room, time = Date.now(), autoMarkAsPlayed = true) => {
    const schedule = cache.file("/data/schedule.json").schedule;
    var history = await getThemeHistory(room);

    // Convert time from seconds to milliseconds if needed (timestamps < year 2001 are likely in seconds)
    const timeMs = time < 1000000000000 ? time * 1000 : time;

    // first, check if any events must trigger and haven't been played yet
    const triggeredEvents = getTriggeredEvents(schedule, room, timeMs);

    if (triggeredEvents.length > 0) {
        const event = triggeredEvents[0];
        const occurrenceTime = getPrevOccurrenceTime(event, timeMs);

        if (autoMarkAsPlayed) {
            markAsPlayed(event, room, occurrenceTime);
        }

        logger.info(`RECURRING EVENT TRIGGERED! Room: ${room}, Event: ${event.id}, Theme: ${event.theme}`);

        return {
            theme: event.theme,
            playlist: event.playlist || "default",
            schedule: event,
            occurrenceTime: time,
            source: "recurring"
        };
    }

    // no events? let's do probability!
    // probabilities are in schedule.json
    const roomProbabilties = schedule.filter(e => e.type === "probability" && e.rooms.includes(room));
    // filter out themes that were recently played
    for (var i = roomProbabilties.length - 1; i >= 0; i--) {
        var event = roomProbabilties[i];
        if (history.includes(event.theme)) {
            roomProbabilties.splice(i, 1);
        }
    }

    // fall-back to vote
    if (roomProbabilties.length === 0) {
        return {
            theme: "vote",
            playlist: null,
            source: "fallback",
            schedule: schedule,
            occurrenceTime: time
        };
    }

    var probabilities = {};
    roomProbabilties.forEach((probabilityEvent) => {
        probabilities[probabilityEvent.theme] = probabilityEvent.probability;
    });

    const theme = selectFromProbability(probabilities);

    if (theme !== "vote") {
        await updateThemeHistory(room, theme);
    }

    return {
        theme: theme,
        playlist: null,
        source: "probability",
        schedule: schedule,
        occurrenceTime: time
    }
};

const selectBoss = async (room) => {
    var history = await getBossHistory(room);
    const bosses = cache.file("/data/bosses.json").bosses;
    const availableBosses = Object.keys(bosses).filter(boss => !history.includes(boss));

    // fall-back to all bosses
    if (availableBosses.length === 0) {
        return null;
    }
    const selectedBoss = availableBosses[Math.floor(Math.random() * availableBosses.length)];

    await updateBossHistory(room, selectedBoss);

    return selectedBoss;
};

const init = (clients) => {
    return;
};

module.exports = {
    init,
    selectTheme,
    markAsPlayed,
    clearEvents,
    selectBoss
};