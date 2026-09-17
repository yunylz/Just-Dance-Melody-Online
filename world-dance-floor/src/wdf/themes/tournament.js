// External modules

// Internal modules
const cache = require("../../lib/cache");
const logger = require("../../lib/logger").createLogger({ service: "wdf/themes/tournament" });
const redis = require("../../lib/redis").client;

// WDF modules
const wdfConfig = cache.file("/data/config.json").config;
var wdfScoring;
var wdfScreens;
var wdfSongSelector;
var wdfNotifications;
var wdfStats;
var wdfSchedule;
var wdfSessions;

var weeklyTournamentWinnersKey = "wdf:weekly-tournament-winners";
var playlistSizeDefault = 3;
var screenSequence = ["tournament-presentation", "tournament-lobby", "in-game", "waiting-screen", "tournament-recap"];

const initModule = (clients) => {
    wdfScoring = clients.wdfScoring;
    wdfScreens = clients.wdfScreens;
    wdfSongSelector = clients.wdfSongSelector;
    wdfNotifications = clients.wdfNotifications;
    wdfStats = clients.wdfStats;
    wdfSchedule = clients.wdfSchedule;
    wdfSessions = clients.wdfSessions;

    return;
};

const addScreensForMap = async (screens, options) => {
    screenSequence.forEach(function(screenType) {
        var startTime = screens.length > 0 ? screens[screens.length - 1].endTime : options.startTime;
        var screenOptions = {
			roomConfigName: options.roomConfigName,
			roomGameVersion: options.roomGameVersion,
			tournamentType: options.tournamentType,
			tournamentLogo: options.tournamentLogo,
			startTime: startTime,
			mapName: options.mapName,
			roundNumber: options.roundNumber,
			playListSize: options.playListSize,
			rewards: options.rewards,
			theme: "tournament"
        };

        if (options.screenDurations && options.screenDurations[screenType])
            screenOptions.duration = options.screenDurations[screenType].duration;

        var screen = wdfScreens.create(screenType, screenOptions);

        if (screen) {
            screens.push(screen);
        }
    });
};

const getRewards = (state) => {
    var tournamentType = state.tournamentType || "default"; 
	var rewards = [];
	switch (tournamentType) {			
		case "ESWC" :
			rewards.push({type: "skin", value: state.skinId});
			break;
		case "weekly":
			rewards.push({type: "badge", value: state.badgeId});	//only for notifs
			rewards.push({type: "mojo", value: 700})				//only for notifs
			break;
		case "happy-hour":
		case "default":
        default:
			rewards.push({type: "skin", value: state.skinIdGold })
			rewards.push({type: "skin", value: state.skinIdSilver })
			rewards.push({type: "skin", value: state.skinIdBronze })
			rewards.push({type: "mojo", value: 700})				//only for notifs
			break;
	}
	state.rewards = rewards;
};

const init = async (options) => {
    var state = options.state;
    
    // Reset state variables for new tournament
    state.currentRound = 0;
    state.generatedScreens = false;
    state.recapComputed = false;
    state.resetRecap = undefined;
    state.inGameScreen = null;
    state.scoringStarted = false;
    
    logger.debug(`[${options.room}] Tournament init: Reset state - currentRound=0, generatedScreens=false, recapComputed=false, scoringStarted=false`);

    try {
        var playlist;
        
        // If a specific playlist was set by the schedule, use it directly
        if (state.playlist) {
            try {
                const wdfConfig = require("../../lib/cache").file("/data/config.json");
                if (wdfConfig && wdfConfig.playlists) {
                    playlist = wdfConfig.playlists[state.playlist];
                    if (!playlist) {
                        logger.warn(`[${options.room}] Scheduled playlist "${state.playlist}" not found in config, falling back to random selection`);
                    } else {
                        logger.info(`[${options.room}] Using scheduled playlist: ${state.playlist}`);
                    }
                } else {
                    logger.warn(`[${options.room}] Config or playlists not available, falling back to random selection`);
                }
            } catch (configErr) {
                logger.warn(`[${options.room}] Error loading config for playlist: ${configErr.message}, falling back to random selection`);
            }
        }
        
        // If no playlist from schedule (or not found), select one randomly
        if (!playlist) {
            playlist = await wdfSongSelector.selectPlaylist({
                room: options.room,
                theme: "tournament",
                shouldUpdatePlaylistHistory: true
            });
        }

        state.selectionRule = playlist;

        var mapList = await wdfSongSelector.generateMapList({
            room: options.room,
            mapList: state.mapList,
            selectionRule: state.selectionRule
        });

        state.mapList = mapList;
        state.tournamentType = playlist.type || "default";
        state.tournamentLogo = playlist.logoUrl || "";
        state.tournamentStartTime = options.lastScreenEndTime;
        state.playlistLength = state.playlistLength || playlist.tournamentLength || playlistSizeDefault;

        if (state.playlistLength > mapList.length) {
            throw new Error("Not enough maps in mapList for the requested playlistLength");
        }

        getRewards(state);

        logger.info(`[${options.room}] Tournament (type: ${state.tournamentType}) theme initialized with ${state.playlistLength} maps`);

        return;
    } catch (err) {
        logger.error(`[${options.room}] wdfThemes::tournament::init()\nFailed to initialize tournament theme: ${err.message}`);
        throw err;
    }
};

const update = async (options) => {
    //logger.debug(`Tournament update called with room: ${options.room}`);
    var state = options.state;

    if (!state.generatedScreens) {
        // do screen generation
        var startTime = options.lastScreenEndTime;
        var screens = [];

        var playlistLength = options.state.playlistLength;
        state.currentRound = ++state.currentRound || 1;

        if (state.currentRound > playlistLength) {
            state.generatedScreens = true;
            return;
        }

        var selectedMap;
        try {
            // Use maps in order for ESWC or playlists with useAllMapsInOrder (like weekly)
            if (state.tournamentType === "ESWC" || state.selectionRule?.useAllMapsInOrder) {
                selectedMap = state.mapList[state.currentRound - 1];
                await wdfSongSelector.updateMapHistory(options.room, selectedMap);
            } else {
                selectedMap = await wdfSongSelector.selectSong({
                    room: options.room,
                    mapList: state.mapList,
                    selectionRule: state.selectionRule,
                    shouldUpdateMapHistory: true,
                    skipMapHistory: state.selectionRule?.skipMapHistory
                });

                // remove map from mapList to avoid repeats
                state.mapList = state.mapList.filter((map) => map !== selectedMap);
            }
        } catch (err) {
            logger.error(`[${options.room}] wdfThemes::tournament::update()\nFailed to select map for tournament theme: ${err.message}`);
            throw err;
        }

        try {
            options.state.mapName = selectedMap;

            addScreensForMap(screens, {
				roomConfigName: state.roomConfigName,
			    roomGameVersion: state.roomGameVersion,
				tournamentType: state.tournamentType || "default",
				tournamentLogo: state.tournamentLogo || "",
			    startTime: startTime,
				screenDurations: state.screenDurations || null,
				mapName: selectedMap,
			    playListSize: playlistLength,
				roundNumber: state.currentRound,
				rewards: state.rewards
            });

            screens.forEach((screen) => {
                if (screen && screen.type === "in-game") {
                    state.inGameScreen = {
                        startTime: screen.startTime,
                        endTime: screen.endTime
                    }
                }
            });

            await wdfNotifications.queueReset({
                room: options.room,
                ingameStartTime: state.inGameScreen.startTime,
                ingameEndTime: state.inGameScreen.endTime,
                theme: state.type,
                lastInGameScreen: (state.currentRound === playlistLength),
                gameVersion: state.roomGameVersion,
                themeData: {
                    tournamentType: state.tournamentType || "default",
                    roundNumber: state.currentRound,
                }
            });

            state.generatedScreens = true;
            state.recapComputed = false;

            if (state.currentRound === playlistLength) {
                screens.push(null);
            }

            return screens;
        } catch (err) {
            logger.error(`[${options.room}] wdfThemes::tournament::update()\nFailed to generate screens for tournament theme: ${err.message}`);
            throw err;
        }
    } else {
        var now = (Date.now() / 1000);

        //logger.debug(`[${options.room}] Tournament update else block: currentRound=${state.currentRound}, playlistLength=${state.playlistLength}, recapComputed=${state.recapComputed}, resetRecap=${state.resetRecap}, inGameScreen=${JSON.stringify(state.inGameScreen)}`);

        // Clean up previous tournament data when first round's in-game screen starts
        // This gives clients time during intro screens to fetch previous tournament recap
        if (state.currentRound === 1 && !state.scoringStarted && state.inGameScreen && now >= state.inGameScreen.startTime) {
            try {
                //logger.debug(`[${options.room}] Cleaning up previous tournament data at round 1 in-game start`);
                await wdfScoring.tournament.cleanUp(options);
                state.scoringStarted = true;
                //logger.debug(`[${options.room}] Cleanup complete, scoringStarted=${state.scoringStarted}`);
            } catch (err) {
                logger.error(`[${options.room}] wdfThemes::tournament::update()\nFailed to clean up previous tournament data: ${err.message}`);
                throw err;
            }
        }

        if (state.inGameScreen && !state.resetRecap && !state.recapComputed && now > state.inGameScreen.startTime) {
            try {
                await wdfScoring.tournament.resetComputeRecap(options);
                state.resetRecap = true;
            } catch (err) {
                logger.error(`[${options.room}] wdfThemes::tournament::update()\nFailed to reset recap computation for tournament theme: ${err.message}`);
                throw err;
            }
        }

        if (state.inGameScreen && now > state.inGameScreen.endTime + wdfConfig.defaultDurations.WDF_DELAY_TOLERANCE_LIMIT && !state.recapComputed) {
            try {
                // #TODO: send tracking data

                await wdfScoring.tournament.computeRecap(options);
                state.recapComputed = true;
                // Only prepare for next round if this isn't the last round
                // For the last round, keep generatedScreens=true so we don't try to generate more screens
                if (state.currentRound < state.playlistLength) {
                    state.generatedScreens = false; // prepare for next round
                }
                state.resetRecap = false;
            } catch (err) {
                logger.error(`[${options.room}] wdfThemes::tournament::update()\nFailed to compute recap for tournament theme: ${err.message}`);
                throw err;
            }
        }

        return;
    }
};

const start = async (options) => {
    options.state.themeStartTime = options.lastScreenEndTime;
    options.state.scoringStarted = false;
    
    try {
        // Don't clean up here - do it when first round starts generating screens
        // This allows clients to still fetch recap from previous tournament
        await wdfScoring.tournament.start(options);
        return;
    } catch (err) {
        logger.error(`[${options.room}] wdfThemes::tournament::start()\nFailed to start tournament scoring: ${err.message}`);
        throw err;
    }
};

const stop = async (options) => {
    var state = options.state;
    
    // Ensure recap is computed before stopping (for the last round)
    if (!state.recapComputed) {
        //logger.debug(`[${options.room}] Computing final recap in stop() as it wasn't computed yet`);
        try {
            await wdfScoring.tournament.computeRecap(options);
            state.recapComputed = true;
        } catch (err) {
            logger.error(`[${options.room}] wdfThemes::tournament::stop()\nFailed to compute final recap: ${err.message}`);
            // Don't throw - continue with stop even if recap fails
        }
    }

    var tournamentWinner;

    try {
        var winner = await wdfScoring.tournament.getTournamentWinner(options);

        tournamentWinner = winner;
    } catch (err) {
        logger.error(`[${options.room}] wdfThemes::tournament::stop()\nFailed to get tournament winner: ${err.message}`);
        throw err;
    }

    try {
        if (options.state.tournamentType && options.state.tournamentType === "weekly" && tournamentWinner) {
            var oneWeekFromNow = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);
            await redis.zAdd(weeklyTournamentWinnersKey, {
                score: oneWeekFromNow,
                value: tournamentWinner
            });
        }
    } catch (err) {
        logger.error(`[${options.room}] wdfThemes::tournament::stop()\nFailed to store weekly tournament winner: ${err.message}`);
        throw err;
    }

    // #TODO: PROCESS ESWC DATA

    try {
        var stars = await wdfScoring.tournament.getStars({
            room: options.room
        });

        await wdfStats.tournament.put(options.room, {
            stars: stars,
            winner: tournamentWinner,
            tournamentType: options.state.tournamentType,
            roomGameVersion: options.state.roomGameVersion
        })
    } catch (err) {
        logger.error(`[${options.room}] wdfThemes::tournament::stop()\nFailed to store tournament stats: ${err.message}`);
        throw err;
    }
};

const updateScore = async (options) => {
    return await wdfScoring.tournament.updateScore(options);
};

const getRecap = async (options) => {
    return await wdfScoring.tournament.getRecap(options);
};

const getScoreStatus = async (options) => {
    return await wdfScoring.tournament.getScoreStatus(options);
};

module.exports = {
    initModule,
    init,
    update,
    start,
    stop,
    updateScore,
    getScoreRecap: getRecap,
    getScoreStatus
};
