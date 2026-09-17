// External modules
const async = require("async");

// Internal modules
const cache = require("../../lib/cache");
const logger = require("../../lib/logger").createLogger({ service: "wdf/themes/vote" });
const redis = require("../../lib/redis").client;

// WDF modules
const wdfConfig = cache.file("/data/config.json").config;
var wdfScoring;
var wdfScreens;
var wdfSongSelector;
var wdfNotifications;
var wdfStats;
var wdfSessions;


var screenSequence = ["vote-lobby", "in-game", "waiting-screen", "vote-recap"];


const computeVoteResults = async (options) => {
    var state = options.state;

    try {
        var multi = redis.multi();

        state.voteOptions.forEach((option) => {
            multi.get("wdf:rooms:" + options.room + ":vote-option:" + option)
        });

        var results = await multi.exec();

        var votes = [];
        var totalVoteValue = 0;

        for (var i = 0; i < state.voteOptions.length; i++) {
            try {
				results[i] = parseInt(results[i] || "0");
			} catch(err) {
				return callback(err);
			}

            votes.push({
                "name": state.voteOptions[i],
                "value": results[i]
            });

            totalVoteValue += results[i];
        }

        // if nobody votes, add a fake vote to both
        if (totalVoteValue === 0) {
            votes[0].value++;
            votes[1].value++;
            totalVoteValue += 2;
        }

        // descending
        votes.sort((a, b) => {
            return b.value - a.value;
        });

        // percentage
        for (i = 0; i < votes.length; i++) {
            votes[i].value = Math.round((votes[i].value / totalVoteValue) * 100);
        }

        // in case of a draw
        if (votes[0].value === votes[1].value) {
            votes[0].value++;
            votes[1].value--;
        }

        return votes;
    } catch (err) {
        logger.error(`[${options.room}] wdfThemes::vote::computeVoteResults()\nError computing vote results: ${err.message}\n${err.stack}`);
        throw err;
    }
};

const addScreensForWinningMap = (screens, options) => {
    screenSequence.forEach((screenType) => {
        var startTime = screens.length > 0 ? screens[screens.length - 1].endTime : options.startTime;

        var screenOptions = {
            roomConfigName: options.roomConfigName,
            roomGameVersion: options.roomGameVersion,
            theme: "vote",
            mapName: options.mapName,
            startTime: startTime
        };

        if (wdfConfig.screenDurations[screenType]) {
            if (screenType === "vote") {
                screenOptions.voteDuration = wdfConfig.screenDurations[screenType].voteDuration;
                screenOptions.waitBeforeVoteCompute = wdfConfig.screenDurations[screenType].waitBeforeVoteCompute;
            } else {
                screenOptions.duration = wdfConfig.screenDurations[screenType].duration;
            }
        }

        var screen = wdfScreens.create(screenType, screenOptions);

        if (screen) {
            screens.push(screen);
        } else {
            logger.warn(`[${options.room}] wdfThemes::vote::addScreensForWinningMap()\nFailed to create screen for type: ${screenType}`);
        }
    });
};

const chooseVoteOptions = async (options) => {
    try {
        var voteOptions = [];
        var state = options.state;

        var playlist = await wdfSongSelector.selectPlaylist({
            room: options.room,
            theme: "vote",
            shouldUpdatePlaylistHistory: true
        });

        state.selectionRule = playlist;

        var mapList = await wdfSongSelector.generateMapList({
            room: options.room,
            mapList: state.mapList,
            selectionRule: state.selectionRule
        });

        state.mapList = mapList;

        await async.timesSeries(2, async (i) => {
            var selectedMap = await wdfSongSelector.selectSong({ room: options.room, mapList: state.mapList, shouldUpdateMapHistory: true });

            voteOptions.push(selectedMap);

            return;
        });

        return voteOptions;
    } catch (err) {
        logger.error(`[${options.room}] wdfThemes::vote::chooseVoteOptions()\nError choosing vote options: ${err.message}\n${err.stack}`);
        throw err;
    }
};

const init = async (options) => {
    var state = options.state;
    state.voteStartTime = null;
    state.generatedScreens = false;

    if (!options.room) {
        logger.error(`wdfThemes::vote::init() was called without room!`);
        return;
    }

    try {
        if (!state.voteOptions) {
            logger.info(`[${options.room}] Choosing vote options...`);
            var voteOptions = await chooseVoteOptions({ room: options.room, state: options.state });
            state.voteOptions = voteOptions;
            //logger.debug(`[${options.room}] Vote options set: ${JSON.stringify(voteOptions)}`);
        }
    } catch (err) {
        logger.error(`[${options.room}] wdfThemes::vote::init()\nError initializing vote theme: ${err.message}\n${err.stack}`);
        throw err;
    }

    return;
};

const cleanUp = async (options) => {
    var state = options.state;
    var multi = redis.multi();

    if (state.voteOptions) {
        state.voteOptions.forEach((option) => {
            multi.del("wdf:rooms:" + options.room + ":vote-option:" + option);
        });
        multi.del("wdf:rooms:" + options.room + ":vote-result");
    }

    try {
        await multi.exec();
        await wdfScoring.map.cleanUp(options);
    } catch (err) {
        logger.error(`[${options.room}] wdfThemes::vote::cleanUp()\nError cleaning up vote theme: ${err.message}\n${err.stack}`);
        throw err;
    }
};

const update = async (options) => {
    var state = options.state;
    
    if (!state.voteOptions) {
        logger.error(`[${options.room}] wdfThemes::vote::update()\nVote update called without voteOptions! State: ${JSON.stringify(state)}`);
        return [null];
    }

    if (!state.voteStartTime) {
        var screen = wdfScreens.create("vote", {
            roomConfigName: state.roomConfigName,
            startTime: options.lastScreenEndTime,
            theme: "vote",
            voteOptions: state.voteOptions
        });
        logger.success(`[${options.room}] Created vote screen with options: ${JSON.stringify(state.voteOptions)}`);
        //logger.debug(`[${options.room}] Vote screen created: ${JSON.stringify(screen)}`);

        // Set state from the created screen so we don't create it again
        state.voteStartTime = screen.voteInfo.voteStartTime;
        state.voteEndTime = screen.voteInfo.voteEndTime;
        state.voteComputeTime = screen.voteInfo.voteComputeTime;
        state.voteResultFetchTime = screen.voteInfo.voteResultFetchTime;
        delete screen.voteInfo.voteComputeTime;

        return [screen];  // Return as array for processThemeData
    }

    var now = (Date.now() / 1000);

    if (now < state.voteComputeTime) {
        return [];
    }

    var winningMap;
    var voteComputeStartTime;

    if (!state.generatedScreens) {
        try {
            voteComputeStartTime = (Date.now() / 1000);
            var voteResult = await computeVoteResults(options);

            winningMap = voteResult[0].name;
            state.winningMap = winningMap;
            state.voteResult = voteResult;

            await redis.set("wdf:rooms:" + options.room + ":vote-result", JSON.stringify(voteResult));

            var voteComputeFinishTime = (Date.now() / 1000);

            if (voteComputeFinishTime >= state.voteResultFetchTime) {
                logger.warn(`[${options.room}] Vote computation took too long (${voteComputeFinishTime - voteComputeStartTime}s)! Results may not have been ready before fetch time.`);
            }

            await wdfSongSelector.updateMapHistory(options.room, winningMap);

            var screens = [];

            addScreensForWinningMap(screens, {
                room: options.room,
                roomConfigName: state.roomConfigName,
                roomGameVersion: state.roomGameVersion,
                mapName: winningMap,
                startTime: options.lastScreenEndTime
            });

            state.generatedScreens = true;

            var inGameScreen;

            screens.forEach((screen) => {
                if (screen.type === "in-game") {
                    inGameScreen = screen;
                }
            });

            screens.push(null);

            // set score compute time
            state.scoreComputeTime = inGameScreen.endTime + wdfConfig.defaultDurations.WDF_DELAY_TOLERANCE_LIMIT;
            state.mapStartTime = inGameScreen.startTime;
            state.mapEndTime = inGameScreen.endTime;

            // queue round in notifications
            try {
                await wdfNotifications.queueReset({
                    room: options.room,
                    ingameStartTime: inGameScreen.startTime,
                    ingameEndTime: inGameScreen.endTime,
                    gameVersion: state.roomGameVersion,
                    theme: state.type,
                    lastInGameScreen: true
                })
            } catch (err) {
                logger.error(`[${options.room}] wdfThemes::vote::update()\nError queueing notification reset for winning map: ${err.message}`);
                throw err;
            }

            return screens;
        } catch (err) {
            logger.error(`[${options.room}] wdfThemes::vote::update()\nError generating screens for winning map: ${err.message}`);
            throw err;
        }
    } else {
        if (!state.recapComputed && now >= state.scoreComputeTime) {
            try {
                await wdfScoring.map.computeRecap(options)
                state.recapComputed = true;
            } catch (err) {
                logger.error(`[${options.room}] wdfThemes::vote::update()\nError computing vote recap: ${err.message}`);
                throw err;
            }

            try {
                var stars = await wdfScoring["map"].getStars({
                    room: options.room
                });

                await wdfStats.vote.put(options.room, {
                    stars: stars,
                    mapName: state.winningMap
                });
            } catch (err) {
                logger.error(`[${options.room}] wdfThemes::vote::update()\nError updating vote stats: ${err.message}`);
                throw err;
            }
        }
    }

    return [];
};

const start = async (options) => {
    options.state.themeStartTime = options.lastScreenEndTime;
    try {
        return await cleanUp(options);
    } catch (err) {
        logger.error(`[${options.room}] wdfThemes::vote::start()\nError starting vote theme: ${err.message}\n${err.stack}`);
        throw err;
    }
};

const computeScoreRecap = async (options) => {
    try {
        return await wdfScoring.map.computeRecap(options);
    } catch (err) {
        logger.error(`[${options.room}] wdfThemes::vote::computeScoreRecap()\nError computing score recap: ${err.message}\n${err.stack}`);
        throw err;
    }
};

const updateScore = async (options) => {
    try {
        return await wdfScoring.map.updateScore(options);
    } catch (err) {
        logger.error(`[${options.room}] wdfThemes::vote::updateScore()\nError updating score: ${err.message}\n${err.stack}`);
        throw err;
    }
};

const getScoreRecap = async (options) => {
    try {
        return await wdfScoring.map.getScoreRecap(options);
    } catch (err) {
        logger.error(`[${options.room}] wdfThemes::vote::getScoreRecap()\nError getting score recap: ${err.message}\n${err.stack}`);
        throw err;
    }
};

const getScoreStatus = async (options) => {
    try {
        return await wdfScoring.map.getScoreStatus(options);
    } catch (err) {
        logger.error(`[${options.room}] wdfThemes::vote::getScoreStatus()\nError getting score status: ${err.message}\n${err.stack}`);
        throw err;
    }
};

const initModule = (clients) => {
    wdfScoring = clients.wdfScoring;
    wdfScreens = clients.wdfScreens;
    wdfSongSelector = clients.wdfSongSelector;
    wdfNotifications = clients.wdfNotifications;
    wdfStats = clients.wdfStats;
    wdfSessions = clients.wdfSessions;

    return;
};

module.exports = {
    init,
    start,
    stop: cleanUp,
    update,
    updateScore,
    getScoreRecap,
    computeScoreRecap,
    getScoreStatus,
    initModule
};