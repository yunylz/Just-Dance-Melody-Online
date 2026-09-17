import asyncLib from "async";
import { file } from "../lib/cache";
import { createLogger } from "../lib/logger";
import { client as redis } from "../lib/redis";
import { WdfClients } from "../types/wdf";

const logger = createLogger({ service: "wdf/song-selector" });
const wdfConfig = file<any>("/data/config.json");
const songDb = file<Record<string, any>>("/data/songdb.json");

const mapHistoryLength = 50;
const playlistHistoryLength = 4;

const getMapHistoryKey      = (room: string) => `wdf:rooms:${room}:song-history`;
const getPlaylistHistoryKey = (room: string) => `wdf:rooms:${room}:playlist-history`;

const getMapHistory = async (room: string): Promise<string[]> => {
    const history = await (redis as any).lRange(getMapHistoryKey(room), 0, -1);
    return history || [];
};

const getPlaylistHistory = async (room: string): Promise<string[]> => {
    const history = await (redis as any).lRange(getPlaylistHistoryKey(room), 0, -1);
    return history || [];
};

export const updateMapHistory = async (room: string, mapName: string): Promise<void> => {
    const multi = (redis as any).multi();
    multi.lPush(getMapHistoryKey(room), mapName);
    multi.lTrim(getMapHistoryKey(room), 0, mapHistoryLength - 1);
    await multi.exec();
};

export const updatePlaylistHistory = async (room: string, playlist: string): Promise<void> => {
    const multi = (redis as any).multi();
    multi.lPush(getPlaylistHistoryKey(room), playlist);
    multi.lTrim(getPlaylistHistoryKey(room), 0, playlistHistoryLength - 1);
    await multi.exec();
};

const selectMapFromList = async (room: string, availableList: string[]): Promise<string> => {
    const history = await getMapHistory(room);
    let newMapList = [...availableList];
    newMapList = history.reduce((newList: string[], mapName: string) => {
        if (newList.length === 1) return newList;
        for (let i = newList.length - 1; i >= 0; i--) {
            if (newList.length === 1) break;
            if (newList[i] === mapName) newList.splice(i, 1);
        }
        return newList;
    }, newMapList);
    return newMapList[Math.floor(Math.random() * newMapList.length)];
};

const selectPlaylistFromList = async (room: string, playlistList: string[], playlistConfigs: Record<string, any>): Promise<string> => {
    const history = await getPlaylistHistory(room);
    let newPlaylistList = [...playlistList];
    newPlaylistList = history.reduce((newList: string[], playlist: string) => {
        if (newList.length === 1) return newList;
        for (let i = newList.length - 1; i >= 0; i--) {
            if (newList.length === 1) break;
            if (newList[i] === "weekly") continue;
            if (newList[i] === playlist) newList.splice(i, 1);
        }
        return newList;
    }, newPlaylistList);

    const weightedList: { name: string; percentage: number; weight?: number }[] = [];
    let totalPercentage = 0;
    for (const playlistName of newPlaylistList) {
        const config = playlistConfigs[playlistName];
        const probability = (config && typeof config.probability === "number") ? config.probability : 1;
        const percentage = Math.max(0, Math.min(100, probability));
        if (percentage > 0) { weightedList.push({ name: playlistName, percentage }); totalPercentage += percentage; }
    }

    if (weightedList.length === 0 || totalPercentage === 0) return newPlaylistList[Math.floor(Math.random() * newPlaylistList.length)];

    const normFactor = 100 / totalPercentage;
    let totalWeight = 0;
    for (const entry of weightedList) { entry.weight = entry.percentage * normFactor; totalWeight += entry.weight; }

    let random = Math.random() * totalWeight, cumulative = 0;
    for (const entry of weightedList) { cumulative += entry.weight!; if (random < cumulative) return entry.name; }
    return weightedList[weightedList.length - 1].name;
};

export const selectSong = async (options: any): Promise<string> => {
    if (!options.room) throw new Error("No room provided");
    const mapList = options.mapList || Object.keys(songDb);
    const bannedMaps: string[] = wdfConfig.config?.bannedMaps || [];
    const filteredSongs = mapList.filter((key: string) => !bannedMaps.includes(key));
    if (filteredSongs.length === 0) throw new Error("No songs available to select from");
    let selectedSong: string;
    if (options.skipMapHistory) selectedSong = filteredSongs[Math.floor(Math.random() * filteredSongs.length)];
    else selectedSong = await selectMapFromList(options.room, filteredSongs);
    if (options.shouldUpdateMapHistory) await updateMapHistory(options.room, selectedSong);
    return selectedSong;
};

export const selectPlaylist = async (options: any): Promise<any> => {
    if (!options.room) throw new Error("No room provided");
    let availablePlaylists: string[] = Object.keys(wdfConfig.playlists || {}) || ["default"];
    if (options.theme === "tournament") {
        availablePlaylists = availablePlaylists.filter((playlist: string) => {
            const cfg = wdfConfig.playlists[playlist];
            return cfg && cfg.tournamentLength && cfg.logoUrl && cfg.logoUrl !== "";
        });
    }
    const selectedPlaylist = await selectPlaylistFromList(options.room, availablePlaylists, wdfConfig.playlists);
    if (options.shouldUpdatePlaylistHistory) await updatePlaylistHistory(options.room, selectedPlaylist);
    return wdfConfig.playlists[selectedPlaylist];
};

export const generateMapList = async (options: any): Promise<string[]> => {
    const selectionRule = options.selectionRule;
    const availableMaps = Object.values(songDb);

    const filterMaps = (mapFilters: any): any[] => {
        let selectedMaps = [...availableMaps];
        if (mapFilters.preselectedMaps?.length > 0) return selectedMaps.filter((s: any) => mapFilters.preselectedMaps.includes(s.mapName));
        if (mapFilters.jdVersion?.length > 0)       selectedMaps = selectedMaps.filter((s: any) => mapFilters.jdVersion.includes(s.originalJDVersion));
        if (mapFilters.difficulty?.length > 0)       selectedMaps = selectedMaps.filter((s: any) => mapFilters.difficulty.includes(s.difficulty));
        if (mapFilters.specificTags?.length > 0)     selectedMaps = selectedMaps.filter((s: any) => s.tags && mapFilters.specificTags.some((t: string) => s.tags.includes(t)));
        if (mapFilters.artist?.length > 0) {
            const artists = mapFilters.artist.map((a: string) => a.toLowerCase());
            selectedMaps = selectedMaps.filter((s: any) => artists.includes(s.artist.toLowerCase()));
        }
        if (mapFilters.coachCount?.length > 0) selectedMaps = selectedMaps.filter((s: any) => mapFilters.coachCount.includes(s.coachCount));
        return selectedMaps;
    };

    const filteredMaps = filterMaps(selectionRule.mapFilters);
    if (filteredMaps.length === 0) throw new Error("No maps available after filtering");
    return filteredMaps.map((s: any) => s.mapName);
};

export const init = (_clients: WdfClients): void => { return; };
