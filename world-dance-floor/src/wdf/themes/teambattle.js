// External modules

// Internal modules
const cache = require("../../lib/cache");
const logger = require("../../lib/logger").createLogger({ service: "wdf/themes/teambattle" });
const oasis = require("../../lib/oasis");

// WDF modules
const wdfConfig = cache.file("/data/config.json").config;
var wdfScoring;
var wdfScreens;
var wdfSongSelector;
var wdfNotifications;

var teamNameDefaultLanguage = "en";
var screenSequence = ["teambattle-intro" , "teambattle-lobby", "in-game", "waiting-screen", "teambattle-recap"];


const initModule = (clients) => {
    wdfScoring = clients.wdfScoring;
    wdfScreens = clients.wdfScreens;
    wdfSongSelector = clients.wdfSongSelector;
    wdfNotifications = clients.wdfNotifications;

    return;
};

const addScreensForMap = async (screens, options) => {
    screenSequence.forEach(function(screenType) {
		var startTime = screens.length > 0 ? screens[screens.length - 1].endTime : options.startTime;
		var screenOptions = {
			roomConfigName: options.roomConfigName,
			roomGameVersion: options.roomGameVersion,
			startTime: startTime,
			mapName: options.mapName,
			theme: "teambattle",
			teams: options.teams,
			teamLocIds: options.teamLocIds
		};

		if (options.screenDurations && options.screenDurations[screenType])
			screenOptions.duration = options.screenDurations[screenType].duration;

		var screen = wdfScreens.create(screenType, screenOptions);

		if (screen) {
			screens.push(screen);
		}
	});

	return true;
};

const init = async (options) => {
    var state = options.state;
    
    // TODO: select a random team!!!!
    state.teamLocIds = [14554, 14555];

    if (!state.teams) {
        if (!state.teamLocIds || !Array.isArray(state.teamLocIds) || state.teamLocIds.length !== 2) {
            throw new Error("Invalid or missing teamLocIds for teambattle theme");
        }

        state.teams = state.teamLocIds.map((teamLocId) => {
            return oasis.getLocalization(teamLocId, teamNameDefaultLanguage);
        });
    } else {
        if (!Array.isArray(state.teams) || state.teams.length !== 2) {
            throw new Error("Invalid teams array for teambattle theme");
        }
    }

    return;
};

const update = async (options) => {
    var state = options.state;

    if (!state.screensGenerated) {
        //logger.debug(`[${options.room}] Generating screens for teambattle theme`);
        // do screen generation
        var themeStartTime = options.lastScreenEndTime;
        var screens = [];

        var inGameScreen;
    
        var playlist = await wdfSongSelector.selectPlaylist({
            room: options.room,
            theme: "teambattle",
            shouldUpdatePlaylistHistory: true
        });

        state.selectionRule = playlist;

        var mapList = await wdfSongSelector.generateMapList({
            room: options.room,
            mapList: state.mapList,
            selectionRule: state.selectionRule
        });

        state.mapList = mapList;

        var selectedMap = await wdfSongSelector.selectSong({
            room: options.room,
            mapList: state.mapList,
            selectionRule: state.selectionRule,
            shouldUpdateMapHistory: true
        });

        //logger.debug(`[${options.room}] Selected map: ${selectedMap}`);

        addScreensForMap(screens, {
			roomConfigName: state.roomConfigName,
			roomGameVersion: state.roomGameVersion,
			startTime: themeStartTime,
			screenDurations: state.screenDurations || null,
			mapName: selectedMap,
			teams: state.teams,
		    teamLocIds: state.teamLocIds
	    });

        screens.forEach((screen) => {
            if (screen && screen.type === "in-game") {
                state.scoringStartTime = screen.startTime;
                state.scoringEndTime = screen.endTime + wdfConfig.defaultDurations.WDF_DELAY_TOLERANCE_LIMIT;

                // needed for the notifications
                state.mapStartTime = screen.startTime;
                state.mapEndTime = screen.endTime;

                inGameScreen = screen;
            }
        });

        state.mapName = selectedMap;
        screens.push(null);

        //logger.debug(`[${options.room}] Generated ${screens.length} screens, scoringStartTime=${state.scoringStartTime}, scoringEndTime=${state.scoringEndTime}`);

        await wdfNotifications.queueReset({
            room: options.room,
		    ingameStartTime: inGameScreen.startTime,
			ingameEndTime: inGameScreen.endTime,
			lastInGameScreen: true,
			gameVersion: state.roomGameVersion,
			theme: state.type,
			themeData: {
				teams: state.teams
			}
        })

        state.screensGenerated = true;

        return screens;
    } else {
        // Theme is running: Update the scores within the scoring time
        var now = (Date.now() / 1000);

        if (!state.scoringStartTime || now < state.scoringStartTime) {
            //logger.debug(`[${options.room}] Waiting for scoring to start, now=${now}, scoringStartTime=${state.scoringStartTime}`);
            return;
        }

        if (!state.recapComputed) {
            if (now > state.scoringStartTime && now < state.scoringEndTime) {
                // update scoring lib if within scoring time.
                //logger.debug(`[${options.room}] Updating scores, now=${now}, scoringEndTime=${state.scoringEndTime}`);
                await wdfScoring.teambattle.update({ room: options.room, teams: state.teams});
            } else if (now > state.scoringEndTime) {
                //logger.debug(`[${options.room}] Computing recap, now=${now}, scoringEndTime=${state.scoringEndTime}`);
                await wdfScoring.teambattle.computeRecap({
                    room: options.room,
                    teams: state.teams,
                    state: state
                });
                state.recapComputed = true;
                //logger.debug(`[${options.room}] Recap computed and state.recapComputed set to true`);
            }
        } else {
            //logger.debug(`[${options.room}] Recap already computed, skipping`);
        }
        return;
    }   
};

const start = async (options) => {
    return await wdfScoring.teambattle.start(options);
};

const stop = async (options) => {
    // Don't clean up here - let the next theme's start() handle cleanup
    // This prevents a race condition where a client requests score-status 
    // between stop() deleting keys and start() creating new ones
    //logger.debug(`[${options.room}] Teambattle theme stopped, deferring cleanup to next theme's start()`);

    return await wdfScoring.teambattle.cleanUp(options);
};

const updateScore = async (options) => {
    return await wdfScoring.teambattle.updateScore(options);
};

const getRecap = async (options) => {
    return await wdfScoring.teambattle.getRecap(options);
};

const getScoreStatus = async (options) => {
    return await wdfScoring.teambattle.getScoreStatus(options);
};


module.exports = {
    initModule,
    init,
    update,
    updateScore,
    start,
    stop,
	getScoreRecap: getRecap,
    getScoreStatus
};