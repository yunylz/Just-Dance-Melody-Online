const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const rateLimitMiddleware = require("../ratelimit/rate-limiter");
const recommendedFilePath = path.resolve(__dirname, '../data/songdb/recommended.json');
const logger = require("../logger/logger");
const validator = require("../logger/sessionvalidator");
const MapPlayedCount = require('./model/MapPlayedCount');

const redis = require('redis');
const {
	createClient
} = require('@redis/client');

const redisUrl = 'redis://127.0.0.1:6379';

const client = createClient({
	url: redisUrl
});

client.on('error', (err) => {
	logger.error(err, 'Carousel Module: Redis client error:');
});

client.connect().then(() => {
	logger.info('Carousel Module: Redis client connected');
}).catch(err => {
	logger.error(err, 'Failed to connect to Redis:');
});
const fileCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const getTopPlayedMaps = async (limit = 10) => {
	const maps = await MapPlayedCount.aggregate([{
			$project: {
				mapName: 1,
				totalCount: {
					$reduce: {
						input: {
							$objectToArray: "$mapCountByCountry"
						},
						initialValue: 0,
						in: {
							$add: ["$$value", "$$this.v"]
						}
					}
				}
			}
		},
		{
			$sort: {
				totalCount: -1
			}
		},
		{
			$limit: limit
		}
	]);

	return maps.map(map => map.mapName); // Return only the map names
};
async function loadJsonFile(filename) {
  try {
    const filePath = path.join(__dirname, filename);
    const cacheKey = filePath;
    const now = Date.now();
    
    // Check if we have a valid cached version
    if (fileCache.has(cacheKey)) {
      const cached = fileCache.get(cacheKey);
      if (now - cached.timestamp < CACHE_TTL) {
        return cached.data;
      }
    }
    
    // Load fresh data
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const data = JSON.parse(fileContent);
    
    // Cache with timestamp
    fileCache.set(cacheKey, {
      data,
      timestamp: now
    });
    
    return data;
  } catch (error) {
    console.error(`Error loading ${filename}:`, error);
    return null;
  }
}


function cleanupCache() {
  const now = Date.now();
  for (const [key, value] of fileCache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      fileCache.delete(key);
    }
  }
}

setInterval(cleanupCache, 10 * 60 * 1000);

function filterSongsBySearch(songs, searchString) {
  const searchLower = searchString.toLowerCase();
  const results = [];
  
  for (const [mapName, data] of Object.entries(songs)) {
    const title = (data.title || '').toLowerCase();
    const artist = (data.artist || '').toLowerCase();
    const tags = (data.tags || []);
    const customType = (data.customTypeName || '').toLowerCase();
    const gameVersion = String(data.originalJDVersion || '').toLowerCase();
    
    const matches = title.includes(searchLower) ||
                   artist.includes(searchLower) ||
                   tags.some(tag => tag.toLowerCase().includes(searchLower)) ||
                   gameVersion.includes(searchLower) ||
                   customType.includes(searchLower);
    
    if (matches) {
      // Create object without spread operator to reduce memory allocation
      results.push({
        mapName,
        title: data.title,
        artist: data.artist,
        tags: data.tags,
        customTypeName: data.customTypeName,
        originalJDVersion: data.originalJDVersion,
        coachCount: data.coachCount,
        difficulty: data.difficulty,
        customTypeNameId: data.customTypeNameId
      });
    }
  }
  
  return results;
}

// Helper function to filter songs based on rules
async function filterSongs(songs, rules, searchString = null) {
  if (rules.class === 'searchResult' && searchString) {
    return filterSongsBySearch(songs, searchString);
  }

  const uniqueMapNames = new Set();
  const uniqueFilteredSongs = [];

  const addUniqueMap = (song) => {
    if (!uniqueMapNames.has(song.mapName)) {
      uniqueMapNames.add(song.mapName);
      uniqueFilteredSongs.push(song);
    }
  };

  if (rules.isTopPlayed) {
    const topPlayedMapNames = await getTopPlayedMaps();
    const topPlayedSet = new Set(topPlayedMapNames); // Use Set for O(1) lookup
    
    for (const [mapName, data] of Object.entries(songs)) {
      if (topPlayedSet.has(mapName)) {
        addUniqueMap({ mapName, ...data });
      }
    }
  } else if (rules.isRecommendations) {
    const recommendations = await loadJsonFile('../data/songdb/recommended.json');
    const recommendationsSet = new Set(recommendations);
    
    for (const [mapName, data] of Object.entries(songs)) {
      if (recommendationsSet.has(mapName)) {
        addUniqueMap({ mapName, ...data });
      }
    }
  } else if (rules.isRecentlyAdded) {
    const entries = Object.entries(songs);
    const recentEntries = entries.slice(-10);
    
    for (const [mapName, data] of recentEntries) {
      addUniqueMap({ mapName, ...data });
    }
  } else { 
    for (const [mapName, data] of Object.entries(songs)) {
      const song = { mapName, ...data };
      
      const passesFilter = (!rules.tagsEnabled || rules.allowedTags.some(tag => song.tags.includes(tag))) &&
                          (!rules.jdVersionEnabled || rules.allowedJDVersions.includes(song.originalJDVersion)) &&
                          (!rules.coachCountEnabled || rules.allowedCoachCount.includes(song.coachCount)) &&
                          (!rules.difficultyEnabled || rules.allowedDifficulty.includes(song.difficulty)) &&
                          (!rules.artistEnabled || rules.allowedArtist.includes(song.artist)) &&
                          (!rules.customTypeEnabled || rules.allowedCustomTypeName.includes(song.customTypeName) || rules.allowedCustomTypeId.includes(song.customTypeNameId)) &&
                          (!rules.excludeMapNameEnabled || !rules.excludedMapNames.some(excluded => song.mapName.includes(excluded))) &&
                          (!rules.excludeCustomTypeNameEnabled || !rules.excludedCustomTypeNames.includes(song.customTypeName));
      
      if (passesFilter) {
        addUniqueMap(song);
      }
    }
  }
  
  if (rules.sortNames) {
    uniqueFilteredSongs.sort((a, b) => a.title.localeCompare(b.title));
  }
  
  if (rules.reverseOrder) {
    uniqueFilteredSongs.reverse();
  }

  return uniqueFilteredSongs;
}

function createComponent(componentName, schema, song = null, isNew = false) {
  const componentTemplate = schema.components[componentName];
  
  if (!componentTemplate) {
    return null;
  }
  
  // Create shallow copy instead of spread
  const component = Object.assign({}, componentTemplate);
  
  if (component.__class === 'JD_CarouselContentComponent_Song' && song) {
    component.mapName = song.mapName;
    if (isNew) {
      component.isNewSong = isNew;
    }
  }

  return component;
}

async function createItems(itemConfig, schema, songDb,searchString) {
  const itemType = schema.itemTypes[itemConfig.itemType];
  const items = [];

  if (itemConfig.class === 'SongItem' || itemConfig.class === 'searchResult' ) {
    const filteredSongs = await filterSongs(songDb, itemConfig,searchString);
   const lastTenSongs = new Set(
	Object.entries(songDb)
    .slice(-10)
    .map(([mapName]) => mapName)
);


filteredSongs.forEach(song => {
  const item = {
    __class: itemType.__class,
    isc: itemType.isc,
    act: itemType.act,
    actionList: itemType.actionList,
    components: itemType.components.map(componentName => 
      createComponent(componentName, schema, song, lastTenSongs.has(song.mapName))
    )
  };
  items.push(item);
    });
  } else if (itemConfig.class === 'defaultItem') {
    const item = { ...itemType };
    if (item.components) {
      item.components = item.components.map(componentName => 
        createComponent(componentName, schema)
      );
    }
    items.push(item);
  }

  return items;
}
const environmentMap = {
  "Patreon": "patreon",
  "Production": "all",
  "Developer": "dev"
};

router.post('/carousel/v2/pages/:page', validator, rateLimitMiddleware, async (req, res) => {
  // kill avatar screen for jd17-18 nx
  if ((req.headers["x-skuid"] === "jd2017-nx-all" || req.headers["x-skuid"] === "jd2018-nx-all") && (req.params.page === "avatars" || req.params.page === "skins")) {
    return res.status(404).json({ status: 404, error: 'Not Found' });
  }
  
  try {
    const authorization = req.headers['authorization'];
    const token = authorization.substring(7, 257);
    const tokenKey = `validatedTokens:${token}`;
    const tokenData = await client.get(tokenKey);

    if (!tokenData) {
      return res.status(401).json({ status: 401, error: 'Unauthorized' });
    }
    
    const { Environment } = JSON.parse(tokenData);
    const finalEnv = environmentMap[Environment] || "all";
    const { page } = req.params;
    const skuId = req.headers['x-skuid'];
    
    const env = finalEnv;
    const { searchString } = req.body;

    const schema = await loadJsonFile('../data/carouseldb/schema.json');
    const pageConfig = schema.pages[page];
    
    if (!pageConfig) {
      let newUrl;
      if (Environment === 'Crack') {
        newUrl = `https://jd-api-backup.azure-api.net/crack${req.originalUrl}`;
      } else {
        newUrl = `https://jd-api-backup.azure-api.net${req.originalUrl}`;
      }
      return res.redirect(307, newUrl);
    }
    
    const songDb = await loadJsonFile(`../data/songdb/jdmelody-nx-${env}.json`);
    
    const categories = await Promise.all(
      pageConfig.categories.map(async (categoryName) => {
        const categoryConfig = schema.categories[categoryName];

        if (!categoryConfig.allowedGames.some(game => skuId.startsWith(game))) {
          return null; // Return null instead of empty object
        }
        
        const categoryItems = [];
        for (const [, itemConfig] of Object.entries(categoryConfig.items)) {
          const items = await createItems(itemConfig, schema, songDb, searchString);
          categoryItems.push(...items);
        }

        return {
          __class: "Category",
          title: categoryConfig.displayName,
          act: categoryConfig.act || "ui_carousel",
          isc: categoryConfig.isc || "grp_row",
          items: categoryItems
        };
      })
    );
    
    const filteredCategories = categories.filter(Boolean);
    
    if (searchString && searchString.trim() !== "" && schema.categories.search_result) {
      const searchConfig = schema.categories.search_result;
      if (searchConfig.allowedGames.some(game => skuId.startsWith(game))) {
        const searchItems = await createItems(searchConfig.items.search, schema, songDb, searchString);
        if (searchItems.length > 0) {
          filteredCategories.unshift({
            __class: "Category",
            title: `[icon:SEARCH_RESULT] ${searchString}`,
            act: "ui_carousel",
            isc: searchConfig.isc || "grp_row",
            items: searchItems
          });
        }
      }
    }
    
    const response = {
      __class: "JD_CarouselContent",
      categories: filteredCategories,
      actionLists: {},
      songItemLists: pageConfig.songItemLists || {}
    };

    for (const listName of pageConfig.actionLists) {
      response.actionLists[listName] = schema.actionLists[listName];
    }

    res.json(response);
    
  } catch (error) {
    logger.error(error, 'Error processing carousel page:');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;