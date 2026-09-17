/**
 * WORLD DANCE FLOOR - MAP THEME LOGIC
 * 
 * Handles map theme screens and related logic.
 */

// External modules
const async = require("async");
const cache = require("../../lib/cache");
const logger = require("../../lib/logger").createLogger({ service: "wdf/themes/map" });

var songdb = cache.file("/data/songdb.json");

// WDF modules
const wdfConfig = cache.file("/data/config.json").config;
var wdfScoring;
var wdfScreens;
var wdfSongSelector;
var wdfNotifications;

var maxPlaylistSizeDefault = 1;
var minPlaylistSizeDefault = 1;
var screenSequence = ["map-lobby", "in-game", "waiting-screen", "map-recap"];


const addScreensForMap = (screens, options) => {
    screenSequence.forEach(screenType => {
        var startTime = screens.length > 0 ? screens[screens.length - 1].endTime : options.startTime;

        var screenOptions = {
            theme: "map", 
            mapName: options.mapName,
            startTime: startTime
        };

        screenOptions.duration = wdfConfig.screenDurations[screenType].duration;

        var screen = wdfScreens.create(screenType, screenOptions);

        if (screen) {
            screens.push(screen);
        } else {
            logger.warn(`Failed to create screen for type: ${screenType}`);
        }
    });
};

const init = async (options) => {
    var state = options.state;
    
    var playlist = await wdfSongSelector.selectPlaylist({
        room: options.room,
        theme: "map",
        shouldUpdatePlaylistHistory: true
    });

    state.selectionRule = playlist;

    var mapList = await wdfSongSelector.generateMapList({
        room: options.room,
        mapList: state.mapList,
        selectionRule: state.selectionRule
    });

    state.mapList = mapList;

    return;
};

const update = async (options) => {
    var state = options.state;
    //logger.info(`Map theme update called, generatedScreens: ${state.generatedScreens || false}, lastScreenEndTime: ${options.lastScreenEndTime}`);

    if (!state.generatedScreens) {
        var startTime = options.lastScreenEndTime;
        var screens = [];

        state.minPlaylistSize = state.minPlaylistSize || minPlaylistSizeDefault;
		state.maxPlaylistSize = state.maxPlaylistSize || maxPlaylistSizeDefault;

		state.minPlaylistSize = Math.max(state.minPlaylistSize, minPlaylistSizeDefault);
		state.maxPlaylistSize = Math.max(state.maxPlaylistSize, maxPlaylistSizeDefault);

		var playListSize = Math.ceil(Math.random() * Math.abs(state.maxPlaylistSize - state.minPlaylistSize)) + state.minPlaylistSize;

        await async.timesSeries(playListSize, async (i) => {
            var selectedMap = await wdfSongSelector.selectSong({ room: options.room });
            logger.info(`Selected map for playlist ${i}: ${selectedMap}`);

            if (!selectedMap) {
                throw new Error("No valid map could be selected for map theme");
            }

            addScreensForMap(screens, {
                startTime: startTime,
                mapName: selectedMap
            });
        });
        
        state.inGameScreens = [];
        state.resetComputeRecapTimestamp = [];

        screens.forEach((screen) => {
            if (screen.type === "in-game") {
                state.inGameScreens.push({
                    startTime: screen.startTime,
                    endTime: screen.endTime
                });
                state.resetComputeRecapTimestamp.push(screen.startTime);
            }
        });

        state.inGameScreens.forEach(async (screen) => {
            await wdfNotifications.queueReset({
                room: options.room,
                ingameStartTime: screen.startTime,
                ingameEndTime: screen.endTime,
                theme: state.type,
                lastInGameScreen: screen.endTime === state.inGameScreens[state.inGameScreens.length - 1].endTime
            })
        });

        logger.info(`Generated ${screens.length} screens for map theme`);
        screens.forEach((screen, index) => {
            logger.info(`Screen ${index}: type=${screen.type}, mapName=${screen.mapName}, startTime=${screen.startTime}, endTime=${screen.endTime}`);
        });

        state.generatedScreens = true;
        
        // Add null to signal completion - this marks finishedGeneratingScreens
        screens.push(null);
        
        return screens;
    } else {
        var now = (Date.now() / 1000);

        if (state.resetComputeRecapTimestamp &&
            state.resetComputeRecapTimestamp.length > 0 &&
            now > (state.resetComputeRecapTimestamp[0] + 10)) {
                await wdfScoring.map.resetComputeRecap(options);
                logger.info(`Resetting compute recap timestamp, returning empty screens`);

                state.resetComputeRecapTimestamp.shift();
                return [];
            }
        
        if (state.inGameScreens &&
            state.inGameScreens.length > 0 &&
            now > (state.inGameScreens[0].endTime + 5)) {
                await wdfScoring.map.computeRecap(options);
                logger.info(`Shifting in-game screen, returning empty screens`);

                state.inGameScreens.shift();
                return [];
        }
    }

    //logger.info(`Map theme update returning empty screens (no actions taken)`);
    return [];
};

const start = async (options) => {
	//var reply = await wdfScoring.map.cleanUp(options);
    //return reply;
    return;
};

const stop = async (options) => {
	var reply = await wdfScoring.map.cleanUp(options);
    return reply;
}

const computeScoreRecap = async (options) => {
	var reply = await wdfScoring.map.computeRecap(options);
    return reply;
};

const updateScore = async (options) => {
	var reply = await wdfScoring.map.updateScore(options);
    return reply;
};

const getScoreRecap = async (options) => {
	logger.info(`[${options.room}] Getting score recap with options ${JSON.stringify(options)}`);
	var reply = await wdfScoring.map.getRecap(options);
    logger.info(`[${options.room}] Got recap from scoring: ${JSON.stringify(reply)}`);
	return reply;
};

const getScoreStatus = async (options) => {
	var reply = await wdfScoring.map.getScoreStatus(options);
    return reply;
};

const initModule = (clients) => {
    wdfScoring = clients.wdfScoring;
    wdfScreens = clients.wdfScreens;
    wdfSongSelector = clients.wdfSongSelector;
    wdfNotifications = clients.wdfNotifications;

    return;
};


module.exports = {
    init,
    update,
    start,
    stop,
    initModule,
	updateScore,
	getScoreRecap,
	computeScoreRecap,
	getScoreStatus
};