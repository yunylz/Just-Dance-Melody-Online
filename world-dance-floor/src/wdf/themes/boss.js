// External modules

// Internal modules
const cache = require("../../lib/cache");
const logger = require("../../lib/logger").createLogger({ service: "wdf/themes/boss" });

// WDF modules
const wdfConfig = cache.file("/data/config.json").config;
var wdfScoring;
var wdfScreens;
var wdfSessions;
var wdfSongSelector;
var wdfNotifications;
var wdfSchedule;

var minMaps = 1;
var maxMaps = 3;
var screenSequence = ["boss-intro", "boss-lobby", "in-game", "waiting-screen", "boss-recap"];


// #TODO: send tracking data

const initModule = (clients) => {
    wdfScoring = clients.wdfScoring;
    wdfScreens = clients.wdfScreens;
    wdfSessions = clients.wdfSessions;
    wdfSongSelector = clients.wdfSongSelector;
    wdfNotifications = clients.wdfNotifications;
    wdfSchedule = clients.wdfSchedule;

    return;
};

const addScreensForMap = (screens, options) => {
    var screenStartTime = options.startTime;

    screenSequence.forEach(screenType => {
        var screenOptions = {
            theme: "boss", 
            mapName: options.mapName,
            startTime: screenStartTime,
            roomConfigName: options.roomConfigName,
            roomGameVersion: options.roomGameVersion,
            bossInfo: options.bossInfo
        };

        if (options.screenDurations && options.screenDurations[screenType])
            screenOptions.duration = options.screenDurations[screenType].duration;

        var screen = wdfScreens.create(screenType, screenOptions);

        if (screen) {
            screens.push(screen);
            screenStartTime = screen.endTime;
        }
    });

    return true;
};

const pushStartRoundNotifications = async (options) => {
    var state = options.state;
    var roundTarget = (state.bossState.bossMaxHealth/state.playlistLength) * (state.currentRound - 1);
    var startRoundNotifications = [];

    if (state.currentRound === 1) {
        startRoundNotifications.push("boss-startBattle")
    } else {
        if (state.bossState.previousRoundStars > roundTarget) {
            startRoundNotifications.push("boss-leadingCommunity");
        } else {
            if (state.bossState.previousRoundStars > (roundTarget * 0.8)) {
                startRoundNotifications.push("boss-onPointCommunity");
            } else {
                startRoundNotifications.push("boss-trailingCommunity");
            }
        }
    }

    try {
        await wdfNotifications.pushNotifications({
            room: options.room,
            notifications: startRoundNotifications
        })
    } catch (err) {
        logger.error(`[${options.room}] wdfThemes::boss::pushStartRoundNotifications()\nFailed to push start round notifications: ${err.message}`);
        throw err;
    }
};

const init = async (options) => {
    var state = options.state;

    // choose a random boss and assign its data
    var bossDb = cache.file("/data/bosses.json").bosses;
    var bosses = Object.keys(bossDb);
    var selectedBoss = await wdfSchedule.selectBoss(options.room);
    var boss = bossDb[selectedBoss];

    state.bossName = boss.bossId;
    if (boss.config) {
        state.bossDifficulty = boss.config.bossDifficulty;
        state.playlistLength = boss.config.playlistLength;
    } else {
        console.log(boss)
        logger.error(`[${options.room}] Boss ${boss.bossId} has no config!`);
        state.bossDifficulty = 5; // default difficulty
        // randomize playlist length between 1 and 3
        state.playlistLength = Math.floor(Math.random() * (maxMaps - minMaps + 1)) + minMaps;
    }

    // default if there is no valid bossDifficulty
    if (!state.bossDifficulty || state.bossDifficulty < 1 || state.bossDifficulty > 6) {
        state.bossDifficulty = 5;
    }

    if (!state.bossName) {
        throw new Error("No bossName provided for boss theme");
    }

    if (!state.hasOwnProperty("playlistLength")) {
        state.playlistLength = minMaps;
    }

    //Default playlist lengths
    if (state.playlistLength < minMaps) {
        state.playlistLength = minMaps;
    }

    if (state.playlistLength > maxMaps) {
        state.playlistLength = maxMaps;
    }

    //logger.debug(`[${options.room}] Boss init: bossName=${state.bossName}, bossDifficulty=${state.bossDifficulty}, playlistLength=${state.playlistLength}`);

    try {
        var playlist = await wdfSongSelector.selectPlaylist({
            room: options.room,
            theme: "boss",
            shouldUpdatePlaylistHistory: true
        });

        state.selectionRule = playlist;

        var mapList = await wdfSongSelector.generateMapList({
            room: options.room,
            mapList: state.mapList,
            selectionRule: state.selectionRule
        });

        state.mapList = mapList;

        var numberOfPlayers = await wdfSessions.getNumberOfPlayers(options);

        if (!numberOfPlayers || numberOfPlayers < 1) numberOfPlayers = 1;

        var starsToWin = numberOfPlayers * state.bossDifficulty * state.playlistLength;

        options.state.currentRound = 0;
        options.state.bossState = {
            bossMaxHealth: starsToWin,
            bossHealth: starsToWin
        };
    } catch (err) {
        logger.error(`[${options.room}] wdfThemes::boss::init()\nFailed to initialize boss theme: ${err.message}`);
        throw err;
    }

    return;
};

const update = async (options) => {
    var state = options.state;

    if (!state.screensGenerated) {
        var screens = [];

        if (state.bossState.bossHealth <= 0 || state.currentRound === state.playlistLength) {
            state.screensGenerated = true;

            // push the null only if it's not the last map
            if (state.currentRound !== state.playlistLength) screens.push(null)

            return screens;
        }

        state.currentRound++;

        var inGameScreen;

        //Select a song and generate screens for the map
        var selectedMap = await wdfSongSelector.selectSong({
            room: options.room,
            mapList: state.mapList,
            shouldUpdateMapHistory: true
        });

        state.mapName = selectedMap;

        var screensOptions = {
            startTime: options.lastScreenEndTime,
            mapName: selectedMap,
            roomConfigName: state.roomConfigName,
            roomGameVersion: state.roomGameVersion,
            bossInfo: {
                bossName: state.bossName,
                playlistLength: state.playlistLength,
                currentRound: state.currentRound
            },
            screenDurations: state.screenDurations || null
        };

        addScreensForMap(screens, screensOptions);

        //	Set score compute time
        screens.forEach(screen => {
            if (screen && screen.type === "in-game") {
                inGameScreen = screen;
                state.scoringStartTime = screen.startTime;
                state.scoringEndTime = screen.endTime;
                state.mapEndTime = screen.endTime;
            }
        });

        state.screensGenerated = true;
        state.resetComputeRecap = false;
        state.recapComputed = false;

        try {
            await wdfNotifications.queueReset({
                room: options.room,
                ingameStartTime: inGameScreen.startTime,
                ingameEndTime: inGameScreen.endTime,
                lastInGameScreen: state.currentRound >= state.playlistLength,
                gameVersion: state.roomGameVersion,
                theme: state.type,
            });
        } catch (err) {
            logger.error(`[${options.room}] wdfThemes::boss::update()\nFailed to queue reset notification: ${err.message}`);
            throw err;
        }

        if (state.currentRound === state.playlistLength) {
            screens.push(null);
        }

        return screens;
    } else {
        var now = (Date.now() / 1000);

        // theme is running: update the scores
        if (now > state.scoringStartTime && now < state.scoringEndTime) {
            //reset compute recap flag if necessary
            if (!state.resetComputeRecap && now > state.scoringStartTime + wdfConfig.defaultDurations.WDF_DELAY_TOLERANCE_LIMIT) {
                await wdfScoring.boss.resetComputeRecap(options);
                state.resetComputeRecap = true;
            }

            // just before the scoring starts for the map, store how many players are on-time for the map
            var numberOfPlayers = await wdfSessions.getNumberOfPlayers(options);

            options.state.onTimePlayers = numberOfPlayers;

            //Send out start of round notifications
            if (!state.notificationsPushed) {
                await pushStartRoundNotifications(options);
                state.notificationsPushed = true;
            }

            //Update scoring lib
            var bossState = await wdfScoring.boss.update(options);
            state.bossState = bossState;

            return;
        } else if (now > state.scoringEndTime && !state.recapComputed) {
            // #TODO: send tracking data

            await wdfScoring.boss.computeRecap(options);
            state.recapComputed = true;
            state.notificationsPushed = false;
            state.screensGenerated = false;

            return;
        } else {
            return;
        }
    }
};

const start = async (options) => {
    options.state.themeStartTime = options.lastScreenEndTime;
    return await wdfScoring.boss.start(options);
};

const stop = async (options) => {
    return await wdfScoring.boss.cleanUp(options);
};

const updateScore = async (options) => {
    return await wdfScoring.boss.updateScore(options);
};

const getRecap = async (options) => {
    return await wdfScoring.boss.getRecap(options);
};

const getScoreStatus = async (options) => {
    return await wdfScoring.boss.getScoreStatus(options);
};


module.exports = {
    initModule,
    init,
    update,
    start,
    stop,
    initModule,
    updateScore,
    getScoreRecap: getRecap,
    getScoreStatus
};