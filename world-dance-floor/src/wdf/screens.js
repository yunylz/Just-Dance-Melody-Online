/**
 * This module is only for screen generation!
 * 
 * Avoid adding scheduling or other room logic here!
 */

// External modules

// Internal modules
const cache = require("../lib/cache");
const logger = require("../lib/logger").createLogger({ service: "wdf/screens" });

const songdb = cache.file("/data/songdb.json");
const wdfConfig = cache.file("/data/config.json").config;


const bossThemeScreens = (options, screenObject) => {
    if (!options.mapName) throw new Error("No mapname provided");

    screenObject.mapName = options.mapName;

    screenObject.bossInfo = {
        __class: "BossScreenInfo",
        currentRound: options.bossInfo.currentRound,
        playlistLength: options.bossInfo.playlistLength,
        bossName: options.bossInfo.bossName
    };

    return screenObject;
};

const voteScreens = (options, screenObject) => {
    if (!options.voteOptions || !options.waitBeforeVoteCompute || !options.voteDuration) {
        throw new Error("Missing tournament screen options");
    }

    screenObject.voteInfo = {
		__class: "VoteScreenInfo",
		voteOptions: options.voteOptions,				
		voteStartTime: screenObject.startTime,
		voteEndTime: (screenObject.startTime + options.voteDuration),
		voteComputeTime: (screenObject.startTime + options.voteDuration + options.waitBeforeVoteCompute) - 1,
		voteResultFetchTime: (screenObject.startTime + options.voteDuration + 2 * options.waitBeforeVoteCompute),
        // add an extra second just to prevent issues with vote computation taking too long.
    };

    screenObject.endTime = (screenObject.voteInfo.voteResultFetchTime + 2 * 10);

    return screenObject;
};

const tournamentScreens = (options, screenObject) => {
    if (!options.mapName) throw new Error("No mapname provided");

    screenObject.mapName = options.mapName;
    screenObject.tournamentInfo = {
        __class: "TournamentScreenInfo",
        tournamentType: options.tournamentType,
        tournamentLogo: options.tournamentLogo,
        roundNumber: options.roundNumber,
        playListSize: options.playListSize,
        rewards: options.rewards
    };

    return screenObject;
};

const teambattleScreen = (options, screenObject) => {
    if (!options.mapName) throw new Error("No mapname provided");

    screenObject.mapName = options.mapName;

    screenObject.teamBattleScreenInfo = {
        __class: "TeamBattleScreenInfo",
        teams: options.teams,
        teamLocIds: options.teamLocIds
    };

    return screenObject;
}

const commonScreen = (options, screenObject) => {
    if (!options.mapName) throw new Error("No mapname provided");

    screenObject.mapName = options.mapName;

    return screenObject;
};

const waitingScreen = (options, screenObject) => {
    if (!options.mapName) throw new Error("No mapname provided");

    screenObject.mapName = options.mapName;

    var tpmUpdateInterval = 2;

    screenObject.waitingScreenInfo = {
        __class: "WaitingScreenInfo",
        getRecapTime: screenObject.startTime + 10 + tpmUpdateInterval + 1
    };

    return screenObject;
};

// TODO: check if jd18 and jd19 break if we don't do reward-recap
// actually just fuck reward-recap LOL
// why are people playing on jd19 anyway, i can understand jd18 but :|
var screens = {
    "boss-intro": bossThemeScreens,
    "boss-lobby": bossThemeScreens,
    "boss-recap": bossThemeScreens,
    "vote": voteScreens,
    "vote-lobby": commonScreen,
    "in-game": commonScreen,
	"waiting-screen": 	waitingScreen,
	"vote-recap": 		commonScreen,
	"map-lobby": 		commonScreen,
	"map-recap": 		commonScreen,
	//"reward-recap": 	rewardRecapScreen,
	"spotlight-intro": 	commonScreen,
	"spotlight-lobby": 	commonScreen,
	"spotlight-recap": 	commonScreen,
	"teambattle-intro":	teambattleScreen,
	"teambattle-lobby": teambattleScreen,
	"teambattle-recap": teambattleScreen,
	"tournament-presentation": tournamentScreens,
	"tournament-lobby": tournamentScreens,
	"tournament-recap": tournamentScreens,
    "side-selection": commonScreen,
    "sidevsside-lobby": commonScreen,
    "sidevsside-recap": commonScreen
};

const create = (screenType, options) => {
    var defaultDurations = wdfConfig.screenDurations;
    options = {
        ...options,
        ...defaultDurations[screenType]
    };

    if (screenType === "in-game") {
        if (!songdb[options.mapName] || !songdb[options.mapName].mapLength) {
            logger.warn(`in-game screen creation failed: mapName="${options.mapName}", exists=${!!songdb[options.mapName]}, mapLength=${songdb[options.mapName]?.mapLength}`);
            return false;
        }

        options.duration = songdb[options.mapName].mapLength;
    }

    var screenObject = {
        __class: "Screen",
        type: screenType,
        startTime: options.startTime,
        endTime: options.startTime + options.duration,
        theme: options.theme
    }

    return screens[screenType](options, screenObject);
};

const init = (clients) => {
    return;
};


module.exports = {
    create,
    init
};