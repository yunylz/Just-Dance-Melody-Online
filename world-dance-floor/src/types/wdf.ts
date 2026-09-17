// Shared WDF domain types

export interface SkuInfo {
    skuId: string;
    id: string;
    platform: Platform;
    gameVersion: string;
}

export type Platform = "pc" | "ps4" | "x1" | "nx" | "wiiu" | "ggp";

export interface RoomConfig {
    roomName: string;
    skus: string[];
    enabled: boolean;
    config: RoomInternalConfig;
}

export interface RoomInternalConfig {
    roomGameVersion: string;
    [key: string]: unknown;
}

export interface PlayerProfile {
    name: string;
    country: string;
    avatar: string;
    isSubscribed?: boolean;
    platform?: string;
    [key: string]: unknown;
}

export interface TokenData {
    ProfileId: string;
    [key: string]: unknown;
}

export interface SongEntry {
    artist: string;
    coachCount: number;
    difficulty: number;
    mapLength: number;
    mapName: string;
    originalJDVersion: number;
    tags: string[];
    title: string;
}

export interface WdfConfig {
    bannedMaps: string[];
    defaultDurations: {
        WDF_STALE_SCREEN_TOLERANCE: number;
        WDF_SCREENS_HISTORY_DURATION: number;
        WDF_LEADERBOARD_SEASON_DURATION: number;
        WDF_NOTIFICATION_COMPUTE_DURATION: number;
        WDF_NOTIFICATION_SHOW_DURATION: number;
        WDF_NOTIFICATIONS_RESET_TIMEDIFF: number;
        WDF_DELAY_TOLERANCE_LIMIT: number;
    };
    screenDurations: Record<string, ScreenDurationConfig>;
    [key: string]: unknown;
}

export interface ScreenDurationConfig {
    duration?: number;
    waitBeforeVoteCompute?: number;
    voteDuration?: number;
}

// ── Screen types ──────────────────────────────────────────────────────────────

export type ScreenType =
    | "boss-intro" | "boss-lobby" | "boss-recap"
    | "vote" | "vote-lobby" | "vote-recap"
    | "in-game"
    | "waiting-screen"
    | "map-lobby" | "map-recap"
    | "spotlight-intro" | "spotlight-lobby" | "spotlight-recap"
    | "teambattle-intro" | "teambattle-lobby" | "teambattle-recap"
    | "tournament-presentation" | "tournament-lobby" | "tournament-recap"
    | "side-selection" | "sidevsside-lobby" | "sidevsside-recap";

export interface ScreenObject {
    __class: "Screen";
    type: ScreenType;
    startTime: number;
    endTime: number;
    theme: string;
    mapName?: string;
    bossInfo?: BossScreenInfo;
    voteInfo?: VoteScreenInfo;
    waitingScreenInfo?: WaitingScreenInfo;
    teamBattleScreenInfo?: TeamBattleScreenInfo;
    tournamentInfo?: TournamentScreenInfo;
}

export interface BossScreenInfo {
    __class: "BossScreenInfo";
    currentRound: number;
    playlistLength: number;
    bossName: string;
}

export interface VoteScreenInfo {
    __class: "VoteScreenInfo";
    voteOptions: string[];
    voteStartTime: number;
    voteEndTime: number;
    voteComputeTime: number;
    voteResultFetchTime: number;
}

export interface WaitingScreenInfo {
    __class: "WaitingScreenInfo";
    getRecapTime: number;
}

export interface TeamBattleScreenInfo {
    __class: "TeamBattleScreenInfo";
    teams: unknown[];
    teamLocIds: string[];
}

export interface TournamentScreenInfo {
    __class: "TournamentScreenInfo";
    tournamentType: string;
    tournamentLogo: string;
    roundNumber: number;
    playListSize: number;
    rewards: unknown[];
}

export interface ScreenOptions {
    mapName?: string;
    startTime: number;
    duration?: number;
    theme?: string;
    waitBeforeVoteCompute?: number;
    voteDuration?: number;
    voteOptions?: string[];
    bossInfo?: {
        currentRound: number;
        playlistLength: number;
        bossName: string;
    };
    tournamentType?: string;
    tournamentLogo?: string;
    roundNumber?: number;
    playListSize?: number;
    rewards?: unknown[];
    teams?: unknown[];
    teamLocIds?: string[];
    roomConfigName?: string;
    roomGameVersion?: string;
}

// ── WDF module client map ─────────────────────────────────────────────────────

export interface WdfClients {
    wdfLeaderboard: any;
    wdfNotifications: any;
    wdfRoomManager: any;
    wdfSchedule: any;
    wdfScoring: any;
    wdfScreens: any;
    wdfSessions: any;
    wdfThemes: any;
    wdfSongSelector: any;
    wdfStats: any;
    [key: string]: any;
}

// ── Dancer card / leaderboard ─────────────────────────────────────────────────

export interface DancerCardInfo extends PlayerProfile {
    pid?: string;
    tournamentBadge?: boolean;
    nameSuffix?: number;
}

export interface LbEntry {
    __class?: string;
    dc: DancerCardInfo & { __class?: string };
    rank: number;
    score: number;
    pid: string;
}

export interface SeasonDetails {
    startTime: number;
    endTime: number;
    seasonNumber: number;
}
