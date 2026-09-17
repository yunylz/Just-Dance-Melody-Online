// External modules
const async = require("async");

// Internal modules
const cache = require("../lib/cache");
const logger = require("../lib/logger").createLogger({ service: "wdf/song-selector" });
const redis = require("../lib/redis").client;

// WDF modules
const wdfConfig = cache.file("/data/config.json");
const songDb = cache.file("/data/songdb.json");

var mapHistoryLength = 50;
var playlistHistoryLength = 4;


const getMapHistoryKey = (room) => {
    return `wdf:rooms:${room}:song-history`;
};

const getPlaylistHistoryKey = (room) => {
    return `wdf:rooms:${room}:playlist-history`;
};

const getMapHistory = async (room) => {
    var history = await redis.lRange(getMapHistoryKey(room), 0, -1);
    return history || [];
};

const getPlaylistHistory = async (room) => {
    var history = await redis.lRange(getPlaylistHistoryKey(room), 0, -1);
    return history || [];
};

const updateMapHistory = async (room, mapName) => {
    var redisKey = getMapHistoryKey(room);

    var multi = redis.multi();
    multi.lPush(redisKey, mapName);
    multi.lTrim(redisKey, 0, mapHistoryLength - 1);
    await multi.exec();

    return;
};

const updatePlaylistHistory = async (room, playlist) => {
    //if (playlist === "default") return;

    var redisKey = getPlaylistHistoryKey(room);

    var multi = redis.multi();
    multi.lPush(redisKey, playlist);
    multi.lTrim(redisKey, 0, playlistHistoryLength - 1);
    await multi.exec();

    return;
};

const selectMapFromList = async (room, availableList) => {
    var history = await getMapHistory(room);

    // Create a copy to avoid mutating the original array
    var newMapList = [...availableList];
    
    // Remove maps that are in history
    newMapList = history.reduce((newList, mapName) => {
        if (newList.length === 1) return newList;

        for (var i = newList.length - 1; i >= 0; i--) {
            if (newList.length === 1) break;

            if (newList[i] === mapName) {
                newList.splice(i, 1);
            }
        }
        
        return newList;
    }, newMapList);

    var selectedMap = newMapList[Math.floor(Math.random() * newMapList.length)];

    return selectedMap;
};

const selectPlaylistFromList = async (room, playlistList, playlistConfigs) => {
    var history = await getPlaylistHistory(room);

    // Create a copy to avoid mutating the original array
    var newPlaylistList = [...playlistList];
    
    // Remove playlists that are in history
    newPlaylistList = history.reduce((newList, playlist) => {
        if (newList.length === 1) return newList;

        for (var i = newList.length - 1; i >= 0; i--) {
            if (newList.length === 1) break;
            if (newList[i] === "weekly") continue; // Don't remove weekly
            if (newList[i] === playlist) {
                newList.splice(i, 1);
            }
        }

        return newList;
    }, newPlaylistList);

    // Build weighted list based on probability (treat as percentages 0-100)
    var weightedList = [];
    var totalPercentage = 0;

    for (var i = 0; i < newPlaylistList.length; i++) {
        var playlistName = newPlaylistList[i];
        var config = playlistConfigs[playlistName];
        var probability = (config && typeof config.probability === "number") ? config.probability : 1;
        
        // Treat probability as percentage (0-100)
        var percentage = Math.max(0, Math.min(100, probability)); // Clamp to 0-100
        
        if (percentage > 0) {
            weightedList.push({ name: playlistName, percentage: percentage });
            totalPercentage += percentage;
        }
    }

    // If no playlists with positive probability, fall back to uniform selection
    if (weightedList.length === 0 || totalPercentage === 0) {
        var selectedPlaylist = newPlaylistList[Math.floor(Math.random() * newPlaylistList.length)];
        return selectedPlaylist;
    }

    // Normalize to ensure total is 100% (in case they don't add up)
    var normalizationFactor = 100 / totalPercentage;
    var totalWeight = 0;
    
    for (var i = 0; i < weightedList.length; i++) {
        weightedList[i].weight = weightedList[i].percentage * normalizationFactor;
        totalWeight += weightedList[i].weight;
    }

    // Select based on normalized weight
    var random = Math.random() * totalWeight;
    var cumulative = 0;

    for (var i = 0; i < weightedList.length; i++) {
        cumulative += weightedList[i].weight;
        if (random < cumulative) {
            return weightedList[i].name;
        }
    }

    // Fallback (shouldn't happen)
    return weightedList[weightedList.length - 1].name;
};

const selectSong = async (options) => {
    if (!options.room) throw new Error("No room provided");

    var mapList = options.mapList || Object.keys(songDb);

    // Object.keys(songdb)
    var filteredSongs = mapList.filter((songKey) => {
        var bannedMaps = wdfConfig.config.bannedMaps || [];

        if (bannedMaps.includes(songKey)) {
            return false;
        }
        
        return true;
    });

    if (filteredSongs.length === 0) {
        throw new Error("No songs available to select from");
    }

    // Skip map history check if specified (e.g., for preselected weekly maps)
    var selectedSong;
    if (options.skipMapHistory) {
        selectedSong = filteredSongs[Math.floor(Math.random() * filteredSongs.length)];
    } else {
        selectedSong = await selectMapFromList(options.room, filteredSongs);
    }

    if (options.shouldUpdateMapHistory)
        await updateMapHistory(options.room, selectedSong);

    return selectedSong;
};

const selectPlaylist = async (options) => {
    if (!options.room) throw new Error("No room provided");

    var availablePlaylists = Object.keys(wdfConfig.playlists) || ["default"];

    var theme = options.theme;
    // filter out playlists that dont have logo or length
    if (theme === "tournament") {
        availablePlaylists = availablePlaylists.filter(playlist => {
            const playlistConfig = wdfConfig.playlists[playlist];
            return playlistConfig && (playlistConfig.tournamentLength && playlistConfig.logoUrl && playlistConfig.logoUrl !== "");
        });
    }

    var selectedPlaylist = await selectPlaylistFromList(options.room, availablePlaylists, wdfConfig.playlists);

    if (options.shouldUpdatePlaylistHistory)
        await updatePlaylistHistory(options.room, selectedPlaylist);

    const playlistData = wdfConfig.playlists[selectedPlaylist];

    return playlistData;
};

const generateMapList = async (options) => {
    var selectionRule = options.selectionRule;

    var availableMaps = Object.values(songDb);

    function filterMaps(mapFilters) {
        var selectedMaps = [...availableMaps]; // copy

        // preselected maps
        if (mapFilters.preselectedMaps && mapFilters.preselectedMaps.length > 0) {
            selectedMaps = selectedMaps.filter(song => mapFilters.preselectedMaps.includes(song.mapName));
            return selectedMaps; // these are preselected, there's no need to filter further
        }

        // jdversion
        if (mapFilters.jdVersion && mapFilters.jdVersion.length > 0) {
            selectedMaps = selectedMaps.filter(song => mapFilters.jdVersion.includes(song.originalJDVersion));
        }

        // difficulty
        if (mapFilters.difficulty && mapFilters.difficulty.length > 0) {
            selectedMaps = selectedMaps.filter(song => mapFilters.difficulty.includes(song.difficulty));
        }

        // specific tags
        if (mapFilters.specificTags && mapFilters.specificTags.length > 0) {
            selectedMaps = selectedMaps.filter(song => song.tags && mapFilters.specificTags.some(tag => song.tags.includes(tag)));
        }

        // artist
        if (mapFilters.artist && mapFilters.artist.length > 0) {
            mapFilters.artist = mapFilters.artist.map(artistName => artistName.toLowerCase()); // put artists in lowercase
            selectedMaps = selectedMaps.filter(song => mapFilters.artist.includes(song.artist.toLowerCase())); 
        }

        // coach count
        if (mapFilters.coachCount && mapFilters.coachCount.length > 0) {
            selectedMaps = selectedMaps.filter(song => mapFilters.coachCount.includes(song.coachCount));
        }

        return selectedMaps;
    };

    var filteredMaps = filterMaps(selectionRule.mapFilters);

    if (filteredMaps.length === 0) {
        throw new Error("No maps available after filtering with the provided map filters");
    }

    var mapNames = filteredMaps.map(song => song.mapName);

    return mapNames;
};

const init = (clients) => {
    return;
};


module.exports = {
    updateMapHistory,
    updatePlaylistHistory,
    selectSong,
    selectPlaylist,
    generateMapList,
    init
};