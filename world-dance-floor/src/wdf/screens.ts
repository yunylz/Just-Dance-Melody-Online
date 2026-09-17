import { file } from "../lib/cache";
import { createLogger } from "../lib/logger";
import { WdfClients } from "../types/wdf";

const logger = createLogger({ service: "wdf/screens" });
const songdb = file<Record<string, any>>("/data/songdb.json");
const wdfConfig = file<any>("/data/config.json").config as any;

const bossThemeScreens = (options: any, screenObject: any): any => {
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

const voteScreens = (options: any, screenObject: any): any => {
    if (!options.voteOptions || !options.waitBeforeVoteCompute || !options.voteDuration)
        throw new Error("Missing tournament screen options");
    screenObject.voteInfo = {
        __class: "VoteScreenInfo",
        voteOptions: options.voteOptions,
        voteStartTime: screenObject.startTime,
        voteEndTime: screenObject.startTime + options.voteDuration,
        voteComputeTime: screenObject.startTime + options.voteDuration + options.waitBeforeVoteCompute - 1,
        voteResultFetchTime: screenObject.startTime + options.voteDuration + 2 * options.waitBeforeVoteCompute
    };
    screenObject.endTime = screenObject.voteInfo.voteResultFetchTime + 2 * 10;
    return screenObject;
};

const tournamentScreens = (options: any, screenObject: any): any => {
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

const teambattleScreen = (options: any, screenObject: any): any => {
    if (!options.mapName) throw new Error("No mapname provided");
    screenObject.mapName = options.mapName;
    screenObject.teamBattleScreenInfo = {
        __class: "TeamBattleScreenInfo",
        teams: options.teams,
        teamLocIds: options.teamLocIds
    };
    return screenObject;
};

const commonScreen = (options: any, screenObject: any): any => {
    if (!options.mapName) throw new Error("No mapname provided");
    screenObject.mapName = options.mapName;
    return screenObject;
};

const waitingScreen = (options: any, screenObject: any): any => {
    if (!options.mapName) throw new Error("No mapname provided");
    screenObject.mapName = options.mapName;
    const tpmUpdateInterval = 2;
    screenObject.waitingScreenInfo = {
        __class: "WaitingScreenInfo",
        getRecapTime: screenObject.startTime + 10 + tpmUpdateInterval + 1
    };
    return screenObject;
};

const screenBuilders: Record<string, (options: any, screenObject: any) => any> = {
    "boss-intro":               bossThemeScreens,
    "boss-lobby":               bossThemeScreens,
    "boss-recap":               bossThemeScreens,
    "vote":                     voteScreens,
    "vote-lobby":               commonScreen,
    "in-game":                  commonScreen,
    "waiting-screen":           waitingScreen,
    "vote-recap":               commonScreen,
    "map-lobby":                commonScreen,
    "map-recap":                commonScreen,
    "spotlight-intro":          commonScreen,
    "spotlight-lobby":          commonScreen,
    "spotlight-recap":          commonScreen,
    "teambattle-intro":         teambattleScreen,
    "teambattle-lobby":         teambattleScreen,
    "teambattle-recap":         teambattleScreen,
    "tournament-presentation":  tournamentScreens,
    "tournament-lobby":         tournamentScreens,
    "tournament-recap":         tournamentScreens,
    "side-selection":           commonScreen,
    "sidevsside-lobby":         commonScreen,
    "sidevsside-recap":         commonScreen
};

export const create = (screenType: string, options: any): any => {
    const defaultDurations = wdfConfig.screenDurations;
    options = { ...options, ...defaultDurations[screenType] };

    if (screenType === "in-game") {
        if (!songdb[options.mapName]?.mapLength) {
            logger.warn(`in-game screen creation failed: mapName="${options.mapName}", exists=${!!songdb[options.mapName]}, mapLength=${songdb[options.mapName]?.mapLength}`);
            return false;
        }
        options.duration = songdb[options.mapName].mapLength;
    }

    const screenObject: any = {
        __class: "Screen",
        type: screenType,
        startTime: options.startTime,
        endTime: options.startTime + options.duration,
        theme: options.theme
    };

    return screenBuilders[screenType](options, screenObject);
};

export const init = (_clients: WdfClients): void => { return; };
