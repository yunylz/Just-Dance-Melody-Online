/**
 * This module is in charge of managing rooms (duh) and updating ALL logic!
 * 
 * It doesn't do logic (well, only a little), it's mainly in charge of making
 * sure that every other part of the code is updating and working properly.
 */

// External modules
const async = require("async");

// Internal modules
const cache = require("../lib/cache");
const logger = require("../lib/logger").createLogger({ service: "wdf/room-manager" });
const redis = require("../lib/redis").client;

// WDF modules
const wdfConfig = cache.file("/data/config.json").config;
var wdfNewsFeed;
var wdfNotifications;
var wdfBotsManager;
var wdfSessions;
var wdfLeaderboard;
var wdfSchedule;
var wdfThemes;
var wdfScoring;

var roomIsUpdating = new Map();


const init = (clients) => {
    //wdfNewsFeed = clients.wdfNewsFeed;
    wdfNotifications = clients.wdfNotifications;
    //wdfBotsManager = clients.wdfBotsManager;
    wdfSessions = clients.wdfSessions;
    wdfLeaderboard = clients.wdfLeaderboard;
    wdfSchedule = clients.wdfSchedule;
    wdfThemes = clients.wdfThemes;
    wdfScoring = clients.wdfScoring;

    // Note: roomConfigs and themeConfigs are loaded fresh from cache
    // when needed to ensure we always have the latest values

    return;
};

/**
 * Get room config fresh from cache
 * @param {String} roomName 
 * @returns {Object|null}
 */
const getRoomConfig = (roomName) => {
    var rooms = cache.file("/data/rooms.json").rooms;
    var room = rooms.find((r) => r.roomName === roomName);
    return room && room.config ? room.config : null;
};

/**
 * Get theme config fresh from cache
 * @param {String} themeName 
 * @returns {Object|null}
 */
const getThemeConfig = (themeName) => {
    var allThemeConfigs = cache.file("/data/config.json").themeConfigs;
    return allThemeConfigs[themeName] || null;
};

/**
 * Get all enabled rooms fresh from cache
 * @returns {Array}
 */
const getEnabledRooms = () => {
    var rooms = cache.file("/data/rooms.json").rooms;
    return rooms.filter((r) => r.enabled);
};

const selectTheme = async (options) => {
    // Use current time to check for recurring events, not lastScreenEndTime
    // This ensures we don't miss scheduled events that should start now
    var selectedThemeDetails = await wdfSchedule.selectTheme(
        options.room,
        Date.now(),
        true
    );
    
    var selectedTheme = {};
    var themeName = selectedThemeDetails.theme;

    // validate theme
    if (!themeName || !getThemeConfig(themeName)) {
        logger.error(`[${options.room}] wdfRoomManager::selectTheme()\nselectTheme returned undefined theme name for room '${options.room}', falling back to 'vote'`);
        // use vote as fallback
        themeName = "vote";
    }

    // validate theme implementation
    if (!wdfThemes[themeName]) {
        logger.error(`[${options.room}] wdfRoomManager::selectTheme()\nTheme implementation for '${themeName}' not found, falling back to 'vote'`);
        // use vote as fallback
        themeName = "vote";
    }

    // get theme config
    var themeConfig = getThemeConfig(themeName);

    // data for room manager
    selectedTheme = {
        ...themeConfig
    };

    selectedTheme.type = themeConfig.type;
    selectedTheme.schedule = selectedThemeDetails.schedule;
    
    selectedTheme.state = {
        ...themeConfig,
        themeConfigName: themeName,
        roomConfigName: options.room,
        roomGameVersion: options.roomGameVersion,
        type: themeName,
        playlist: selectedThemeDetails.playlist
    }

    logger.info(`[${options.room}] Selected a theme: ${themeName}. Initializing...`);

    try {
        await wdfThemes[themeConfig.type].init({
            room: options.room,
            state: selectedTheme.state,
            lastScreenEndTime: options.lastScreenEndTime
        });
    } catch (err) {
        logger.error(`[${options.room}] Error initializing theme ${selectedTheme.type}: ${err.message}\n${err.stack}`);
        throw err;
    }

    return selectedTheme;
};

const processThemeData = async (options) => {
    if (options.theme.finishedGeneratingScreens && options.screens && options.screens.length > 0) {
        logger.error(`[${options.room}] wdfRoomManager::processThemeData()\nTheme ${options.theme.type} has already finished generating screens but is still returning more screens.`);
        return;
    }

    // -- CONSOLE LOG ALL SCREENS THAT WERE GENERATED --
    /*
    if (options.screens && options.screens.length > 0) {
    
        logger.info(`[${options.room}] Processing ${options.screens.length} screens for theme ${options.theme.type}`);
        logger.debug(JSON.stringify(options.screens, null, 2));
    }
    */

    try {
        var multi = redis.multi();

        for(var i = 0; options.screens && i < options.screens.length; i++) {
			if (!options.screens[i]) {
				if (i !== (options.screens.length - 1))
					logger.warn(`[${options.room}] wdfRoomManager::processThemeData()\nTheme implementation of type ${options.theme.type} generated screens after the null screen`);
				
				if (i > 0) // when the theme sends a null entry after some screens
					options.theme.endTime = options.screens[i-1].endTime
				else if (!options.theme.finishedGeneratingScreens) // when the theme sends just a null entry (it wants to end)
					options.theme.endTime = options.lastScreenEndTime

				options.theme.finishedGeneratingScreens = true
				break;
			}

			// this is meant to be internal, the game doesn't need to be in the screen data
            //options.screens[i].schedule = options.theme.schedule;

			options.themes.lastScreenEndTime = options.screens[i].endTime
            multi.zAdd(options.screensKey, {
                score: options.screens[i].endTime,
                value: JSON.stringify(options.screens[i])
            })
		}

        await multi.exec((err) => {
            if (err) {
                throw err;
            }
        });
    } catch (err) {
        logger.error(`[${options.room}] wdfRoomManager::processThemeData()\nError processing theme data for theme ${options.theme.type}: ${err.message}\n${err.stack}`);
        throw err;
    }
};

const updateCurrentThemeStage = async (options) => {
    // -- CONSOLE LOG ALL THEMES --
    // logger.debug(`[${options.room}] Current themes data: ${JSON.stringify(options.themes, null, 2)}`);

    var stageActions = {
        "initialized": async (options) => {
            logger.info(`[${options.room}] Starting theme ${options.themes.current.type}`);
            await wdfThemes[options.themes.current.type].start({
                room: options.room,
                lastScreenEndTime: options.themes.lastScreenEndTime,
                state: options.themes.current.state
            }).then(() => {
                options.themes.current.stage = "started";
                
                // YOU MIGHT HAVE TO UNCOMMENT THIS AFTER RESTARTING FOR A LONG PERIOD OF TIME!
                // IF IT'S STUCK ON STALE WARNING!!
                // ONCE IT CREATES A SCREEN, COMMENT AGAIN AND RESTART TO PREVENT ISSUES
                //options.themes.lastScreenEndTime = (Date.now() / 1000);

                logger.info(`[${options.room}] Theme ${options.themes.current.type} started`);
                return;
            }).catch((err) => {
                logger.error(`[${options.room}] wdfRoomManager::updateCurrentThemeStage()\nTheme start error: ${err.message}\n${err.stack}`);
                throw err;
            });
        },
        "started": async (options) => {
            try {
                // logger.info(`[${options.room}] Updating curr theme ${options.themes.current.type}`);

                // update current theme and get new screens if any
                var screens = await wdfThemes[options.themes.current.type].update({
                    room: options.room,
                    lastScreenEndTime: options.themes.lastScreenEndTime,
                    state: options.themes.current.state
                }).catch((err) => {
                    logger.error(`[${options.room}] wdfRoomManager::updateCurrentThemeStage()\nTheme update error: ${err.message}\n${err.stack}`);
                    throw err;
                });
                
                // logger.debug(`[${options.room}] Theme update returned ${screens ? screens.length : 0} screens`);

                await processThemeData({
                    lastScreenEndTime: options.themes.lastScreenEndTime,
                    screens: screens,
                    screensKey: options.screensKey,
                    theme: options.themes.current,
                    themes: options.themes,
                    room: options.room
                }).catch((err) => {
                    logger.error(`[${options.room}] wdfRoomManager::processThemeData()\nprocessThemeData error: ${err.message}\n${err.stack}`);
                    throw err;
                });

                // check if theme should stop
                if (options.themes.current.endTime && (Date.now() / 1000) >= (options.themes.current.endTime)) {
                    await wdfThemes[options.themes.current.type].stop({
                        room: options.room,
                        state: options.themes.current.state,
                        lastScreenEndTime: options.themes.lastScreenEndTime
                    }).then(() => {
                        options.themes.current.stage = "stopped";
                        logger.success(`[${options.room}] Theme ${options.themes.current.type} stopped (endTime reached).`);
                        return;
                    }).catch((err) => {
                        logger.error(`[${options.room}] wdfRoomManager::updateCurrentThemeStage()\nTheme stop error: ${err.message}\n${err.stack}`);
                        throw err;
                    });
                }

                return;
            } catch (err) {
                throw err;
            }
        },
        "stopped": async () => {
            logger.error(`[${options.room}] wdfRoomManager::updateCurrentThemeStage()\nAttempted to stop stopped theme '${options.themes.current.type}' for room '${options.room}'.`);
            throw new Error("theme switch did not happen after current theme was stopped");
        }
    };

    try {
        await stageActions[options.themes.current.stage](options);
        return;
    } catch (err) {
        logger.error(`[${options.room}] wdfRoomManager::updateCurrentThemeStage()\nError updating current theme stage for theme ${options.themes.current.type}: ${err.message}\n${err.stack}`);
        throw err;
    }
};

const updateNextThemeStage = async (options) => {
    try {
        // select the next theme if the current one has finished generating screens
        // and there are no next ones generated, only and ONLY under that criteria
        if (!options.themes.next && options.themes.current.finishedGeneratingScreens) {
            await selectTheme({
                ...options
            }).then((theme) => {
                options.themes.next = theme;
                options.themes.next.stage = "initialized";
                logger.info(`[${options.room}] Next theme selected: ${options.themes.next.type}`);
                return;
            }).catch((err) => {
                logger.error(`[${options.room}] wdfRoomManager::updateNextThemeStage()\nError selecting next theme: ${err.message}\n${err.stack}`);
                throw err;
            });
        }

        // skip this update if the next theme has also finished generating screens
        if (options.themes.next && !options.themes.next.finishedGeneratingScreens) {
            try {
                var screens = await wdfThemes[options.themes.next.type].update({
                    room: options.room,
                    lastScreenEndTime: options.themes.lastScreenEndTime,
                    state: options.themes.next.state
                });

                await processThemeData({
                    lastScreenEndTime: options.themes.lastScreenEndTime,
                    screens: screens,
                    screensKey: options.screensKey,
                    theme: options.themes.next,
                    themes: options.themes,
                    room: options.room
                });
            } catch (err) {
                logger.error(`[${options.room}] wdfRoomManager::updateNextThemeStage()\nError updating next theme stage for theme ${options.themes.next.type}: ${err.message}\n${err.stack}`);
                throw err;
            }
        }
    } catch (err) {
        logger.error(`[${options.room}] wdfRoomManager::updateNextThemeStage()\nError in updateNextThemeStage: ${err.message}\n${err.stack}`);
        throw err;
    }
};

const switchThemes = async (options) => {
    try {
        // prepare automatic news feed entries with stat values pushed by the current theme
        // await wdfNewsFeed.prepareAutomaticNews(options.room);
        
        // clean expired sessions
        await wdfSessions.clean({
            room: options.room
        }).catch((err) => {
            logger.error(`[${options.room}] wdfRoomManager::switchThemes()\nError cleaning sessions: ${err.message}\n${err.stack}`);
            throw err;
        });

        // set currentTheme = nextTheme and start the new current theme
        options.themes.current = options.themes.next;
        delete options.themes.next;

        // start the new current theme
        await wdfThemes[options.themes.current.type].start({
            room: options.room,
            lastScreenEndTime: options.lastScreenEndTime,
            state: options.themes.current.state
        }).then(() => {
            options.themes.current.stage = "started";
            return;
        }).catch((err) => {
            logger.error(`[${options.room}] wdfRoomManager::switchThemes()\nTheme start error: ${err.message}\n${err.stack}`);
            throw err;
        });

        logger.success(`[${options.room}] Switched to new theme: ${options.themes.current.type}`);
        return;
    } catch (err) {
        logger.error(`[${options.room}] wdfRoomManager::switchThemes()\nError switching themes: ${err.message}\n${err.stack}`);
        throw err;
    }
};

const updateThemes = async (room) => {
    // logger.debug(`[${room}] Starting updateThemes`);
    var themesKey = `wdf:rooms:${room}:themes`;
    var screensKey = `wdf:rooms:${room}:screens`;

    var themes = {};
    var stateReset = false;

    var now = (Date.now() / 1000);

    var roomConfig = getRoomConfig(room);

    if (!roomConfig)
        throw new Error(`No room config found for room '${room}'`);
        
    try {
        // get theme states
        var value = await redis.get(themesKey);

        if (value) {
            themes = JSON.parse(value);
        }

        if (!themes.lastScreenEndTime) {
            themes.lastScreenEndTime = now;
            stateReset = true;
        }
        // reset if we're way behind
        else if (themes.lastScreenEndTime < (now - wdfConfig.defaultDurations.WDF_STALE_SCREEN_TOLERANCE)) {
            themes.lastScreenEndTime = now;
            delete themes.current;
            delete themes.next;
            logger.warn(`[${room}] Theme state was stale, resetting state.`);
        }

        // select current theme if not already present
        var theme;
        if (!themes.current) {
            logger.info(`[${room}] No current theme, selecting new theme`);

            // since we don't have a current theme, the state must be stale
            // let's make the lastScreenEndTime now to avoid issues
            //themes.lastScreenEndTime = now;

            await selectTheme({
                room: room,
                roomConfig: roomConfig,
                roomConfigName: room,
                roomGameVersion: roomConfig.roomGameVersion,
                lastScreenEndTime: themes.lastScreenEndTime,
                stateReset: stateReset
            }).then((theme) => {
                themes.current = theme;
                themes.current.stage = "initialized";
                logger.info(`[${room}] Selected current theme: ${themes.current.type}`);
                return;
            }).catch((err) => {
                logger.error(`[${room}] wdfRoomManager::updateThemes()\nError selecting current theme: ${err.message}\n${err.stack}`);
                throw err;
            });
        }

        // update the current theme
        await updateCurrentThemeStage({
            room: room,
            themes: themes,
            screensKey: screensKey,
            roomConfig: roomConfig,
            roomConfigName: room,
            lastScreenEndTime: themes.lastScreenEndTime
        }).catch((err) => {
            logger.error(`[${room}] wdfRoomManager::updateThemes()\nError updating current theme stage: ${err.message}\n${err.stack}`);
            throw err;
        });

        // update the next theme
        await updateNextThemeStage({
            room: room,
            themes: themes,
            screensKey: screensKey,
            roomConfig: roomConfig,
            roomConfigName: room,
            roomGameVersion: roomConfig.roomGameVersion,
            lastScreenEndTime: themes.lastScreenEndTime,
            stateReset: stateReset
        }).catch((err) => {
            logger.error(`[${room}] wdfRoomManager::updateThemes()\nError updating next theme stage: ${err.message}\n${err.stack}`);
            throw err;
        });

        // switch themes if current theme is stopped
        if (themes.current.stage === "stopped") {
            await switchThemes({
                room: room,
                themes: themes,
                lastScreenEndTime: themes.lastScreenEndTime
            });
        }

        // store the theme states in redis
        await redis.set(themesKey, JSON.stringify(themes));

        // clean old screens
        try {
            await redis.zRemRangeByScore(screensKey, "-inf", (now - wdfConfig.defaultDurations.WDF_SCREENS_HISTORY_DURATION));
        } catch (err) {
            logger.error(`[${room}] wdfRoomManager::updateThemes()\nError cleaning old screens: ${err.message}\n${err.stack}`);
        }
    } catch (err) {
        logger.error(`[${room}] wdfRoomManager::updateThemes()\nError updating themes: ${err.message}\n${err.stack}`);
        throw err;
    }
};

const updateRoom = async (options) => {
    return async.parallel([
        async function () {
            // TODO:
            //await wdfNewsFeed.update(options.room);
        },
        async function () {
            await wdfNotifications.update(options.room, options.gameVersion);
        },
        async function () {
            // TODO: 
            //await wdfBotsManager.update(options.room);
        },
        async function () {
            await wdfSessions.update(options.room);
        },
        async function () {
            await wdfLeaderboard.update(options.room, getRoomConfig(options.room));
        },
        async function () {
            await updateThemes(options.room, options.gameVersion);
        }
    ], function(err) {
        if (err) {
            logger.error(`[${options.room}] wdfRoomManager::updateRoom()\nError updating room: ${err.message}\n${err.stack}`);
            throw err;
        }
    });
};

const update = async (options) => {
    var room = options.room;

    // check if lock is currently active
    if (roomIsUpdating.get(room) === true) {
        logger.warn(`Room ${room} is already being updated, skipping update`);
        return;
    }

    // we're going to lock the updates to make sure we don't do it more than once at a time
    roomIsUpdating.set(room, true);

    try {
        await updateRoom(options);
    } catch (err) {
        logger.error(`Error updating room ${room}: ${err.message}\n${err.stack}`);
    } finally {
        roomIsUpdating.set(room, false);
    }
};

const start = (options) => {
    // start a room simply
    var intervalMs = options.intervalMs || 10000;

    setInterval(async () => {
        var rooms = cache.file("/data/rooms.json").rooms;
    
        if (!rooms || rooms.length === 0) {
            logger.warn("No rooms found to update");
            return;
        }

        // check if room is in rooms.json
        if (!rooms.some(room => room.roomName === options.room)) {
            logger.warn(`Room ${options.room} not found in rooms.json, skipping update`);
            return;
        }

        await update(options);
    }, intervalMs);
};

const getCurrentThemeDetails = async (room) => {
    var themesKey = `wdf:rooms:${room}:themes`;

    try {
        var themes = await redis.get(themesKey);

        if (themes) {
            try {
                themes = JSON.parse(themes);
            } catch (err) {
                throw err;
            }
            delete themes.current.state;
            return themes.current;
        }

        return null;
    } catch (err) {
        logger.error(`Error fetching current theme details for room ${room}: ${err.message}\n${err.stack}`);
        return null;
    }
};

const getNextThemeDetails = async (room) => {
    var themesKey = `wdf:rooms:${room}:themes`;

    try {
        var themes = await redis.get(themesKey);

        if (themes) {
            try {
                themes = JSON.parse(themes);
            } catch (err) {
                throw err;
            }
            
            if (themes.next) {
                delete themes.next.state;
                return themes.next;
            }
        }

        return null;
    } catch (err) {
        logger.error(`Error fetching next theme details for room ${room}: ${err.message}\n${err.stack}`);
        return null;
    }
};

const forwardUpdateScores = async (options) => {
    var reply = await wdfThemes[options.type].updateScore(options);

    return reply;
};

const forwardGetScoreRecap = async (options) => {
    //logger.debug(`[${options.room}] Forwarding getScoreRecap for theme ${options.type} with options ${JSON.stringify(options)}`);
    var reply = await wdfThemes[options.type].getScoreRecap(options);
    //logger.debug(`[${options.room}] Got score recap reply: ${JSON.stringify(reply)}`);

    return reply;
};

const forwardGetScoreStatus = async (options) => {
    var reply = await wdfThemes[options.type].getScoreStatus(options);

    return reply;
};


module.exports = {
    init,
    start,
    update,
    getCurrentThemeDetails,
    getNextThemeDetails,
    forwardUpdateScores,
    forwardGetScoreRecap,
    forwardGetScoreStatus
};