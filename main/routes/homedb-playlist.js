const axios = require('axios');
const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const rateLimitMiddleware = require("../ratelimit/rate-limiter");
const validator = require("../logger/sessionvalidator");
const getRandomPlaylistID = (playlists) => {
	const keys = Object.keys(playlists).filter(key => !/reco/i.test(key));
	return keys[Math.floor(Math.random() * keys.length)];
};
const logger = require("../logger/logger");
const {
	createClient
} = require('@redis/client');

const redisUrl = 'redis://127.0.0.1:6379';

const client = createClient({
	url: redisUrl
});
client.on('error', (err) => {
	logger.error(err, 'Session Module: Redis client error:');
});

client.connect().then(() => {
	logger.info('Session Module: Redis client connected');
}).catch(err => {
	logger.error(err, 'Failed to connect to Redis:');
});

client.on('error', (err) => {
	logger.error('HomeDB System: Redis profile client error:', err);
});
// Helper function to get a random map name from jdmelody-nx-all.json
const getRandomMapName = (maps) => {
	const keys = Object.keys(maps);
	return keys[Math.floor(Math.random() * keys.length)];
};

// Helper function to get the last map name from jdmelody-nx-all.json
const getLastMapName = (maps) => {
	const keys = Object.keys(maps);
	return keys[keys.length - 1];
};
const MapPlayedCount = require('./model/MapPlayedCount');

router.post('/home/v1/tiles', validator, rateLimitMiddleware, async (req, res) => {
    const homeDbPath = path.resolve(__dirname, '../data/homedb/home.json');
    const playlistDbPath = path.resolve(__dirname, '../data/playlistdb/playlist.json');
    const jdmelodyNxAllPath = path.resolve(__dirname, '../data/songdb/jdmelody-nx-all.json');
    const jdmelodyNxPatreonPath = path.resolve(__dirname, '../data/songdb/jdmelody-nx-patreon.json');
    const mapsDir = path.resolve(__dirname, '../database/Maps');
    const localizationPath = path.resolve(__dirname, '../data/songdb/localization.json');

    // redis profile shit
    const token = req.headers.authorization.substring(7, 257);
    const tokenKey = `validatedTokens:${token}`;
    const tokenDataRedis = await client.get(tokenKey);
    let tokenData;
    if (tokenDataRedis) {
        tokenData = JSON.parse(tokenDataRedis);
    } else {
        logger.error(`HomeDB Module: Token header not found`);
    }

    // get verification code
    let code = null;
    if (tokenData.ProfileId) {
        try {
            const response = await axios.get(`http://localhost:5442/verification/code?profileId=${tokenData.ProfileId}`);
            code = response.data.code;
        } catch (error) {
            logger.error('HomeDB Module Error: Error fetching verification status:', error);
        }
    }

    // Check if homeDb file exists
    fs.access(homeDbPath, fs.constants.F_OK, (err) => {
        if (err) {
            logger.error('HomeDB Module Error: Homedb file is not present', err);
            return res.status(500).json({
                status: 404,
                error: 'Not Found'
            });
        }

        // Read homeDb file
        fs.readFile(homeDbPath, 'utf8', (err, homeData) => {
            if (err) {
                logger.error('HomeDB Module Error: Error while reading HomeDB json', err);
                return res.status(500).json({
                    status: 500,
                    error: 'Internal Server Error'
                });
            }

            // Read playlistDb file
            fs.readFile(playlistDbPath, 'utf8', (err, playlistData) => {
                if (err) {
                    logger.error('HomeDB Module Error: Error reading playlistdb file:', err);
                    return res.status(500).json({
                        status: 500,
                        error: 'Internal Server Error'
                    });
                }

                // Read jdmelody-nx-all file
                fs.readFile(jdmelodyNxAllPath, 'utf8', (err, jdmelodyData) => {
                    if (err) {
                        logger.error('HomeDB Module Error: Error reading songdb file:', err);
                        return res.status(500).json({
                            status: 500,
                            error: 'Internal Server Error'
                        });
                    }

                    // Read jdmelody-nx-patreon file
                    fs.readFile(jdmelodyNxPatreonPath, 'utf8', (err, jdmelodyPatreonData) => {
                        if (err) {
                            logger.error('HomeDB Module Error: Error reading patreon songdb file:', err);
                            return res.status(500).json({
                                status: 500,
                                error: 'Internal Server Error'
                            });
                        }

                        // Read localization file
                        fs.readFile(localizationPath, 'utf8', (err, localizationData) => {
                            if (err) {
                                logger.error('HomeDB Module Error: Error reading localization file:', err);
                                return res.status(500).json({
                                    status: 500,
                                    error: 'Internal Server Error'
                                });
                            }

                            const homeJson = JSON.parse(homeData);
                            const playlistJson = JSON.parse(playlistData);
                            const jdmelodyJson = JSON.parse(jdmelodyData);
                            const jdmelodyPatreonJson = JSON.parse(jdmelodyPatreonData);
                            const localizationJson = JSON.parse(localizationData);

                            // add verification code to the first tile if it's an info tile
                            if (homeJson.tileList && homeJson.tileList.length > 0) {
                                if (homeJson.tileList[0].type == 2) {
                                    if (code) {
                                        homeJson.tileList[0].newsTileInfo.text += `\n\n[C:ff575757]Your verification code is: [C:ff4a7bdf]${code}\n[C:ff575757]Use this code to link your Discord account to your JDMO profile.\nYou can join the official JDMO Discord at: [C:ff4a7bdf]https://discord.gg/jdmo[C:ff575757]`;
                                    }
                                }
                            }

                            // Proceed to read the .database/maps directory
                            fs.readdir(mapsDir, (err, files) => {
                                if (err) {
                                    logger.error('Error reading maps directory:', err);
                                    return res.status(500).json({
                                        status: 500,
                                        error: 'Internal Server Error'
                                    });
                                }

                                // Filter out non-JSON files
                                files = files.filter(file => path.extname(file) === '.json');

                                // Get stats for each file to get modification date
                                let fileStatsPromises = files.map(file => {
                                    return new Promise((resolve, reject) => {
                                        let filePath = path.join(mapsDir, file);
                                        fs.stat(filePath, (err, stats) => {
                                            if (err) {
                                                reject(err);
                                            } else {
                                                resolve({ file, mtime: stats.mtime });
                                            }
                                        });
                                    });
                                });

                                Promise.all(fileStatsPromises).then(fileStats => {
                                    // Sort files by modification date descending
                                    fileStats.sort((a, b) => b.mtime - a.mtime);

                                    // Prepare variables
                                    let songsByDate = {};
                                    let songsFound = 0;
                                    let index = 0;
                                    const maxSongs = 10;


                                    while (songsFound < maxSongs && index < fileStats.length) {
                                        let fileStat = fileStats[index];
                                        let file = fileStat.file;
                                        let mapName = path.basename(file, '.json');
                                        let date = fileStat.mtime.toISOString().split('T')[0]; 

                                        // Check if mapName exists in either song database
                                        let inPatreon = jdmelodyPatreonJson.hasOwnProperty(mapName);
                                        let inPublic = jdmelodyJson.hasOwnProperty(mapName);

                                        if (inPatreon || inPublic) {
                                            // Get song data (prioritize Patreon data)
                                            let songData = inPatreon ? jdmelodyPatreonJson[mapName] : jdmelodyJson[mapName];

                                            let title = songData.title || 'Unknown Title';
                                            let artist = songData.artist || 'Unknown Artist';

                                            // Handle customTypeName or customTypeNameId
                                            let customType = '';

                                            if (songData.customTypeName && songData.customTypeName !== '') {
                                                customType = songData.customTypeName;
                                            } else if (songData.customTypeNameId && songData.customTypeNameId !== 4294967295) {
                                                let typeId = songData.customTypeNameId.toString();
                                                if (localizationJson[typeId] && localizationJson[typeId]['en']) {
                                                    customType = localizationJson[typeId]['en'];
                                                }
                                            }

                                            // Build the song line
                                            let songLine = `	- ${title} by ${artist}`;
                                            if (customType !== '') {
                                                songLine += ` [${customType}]`;
                                            }

                                            // Add song to the corresponding date group
                                            if (!songsByDate[date]) {
                                                songsByDate[date] = [];
                                            }
                                            songsByDate[date].push(songLine);

                                            songsFound++;
                                        }

                                        index++;
                                    }

                                    // Build the textLines array
                                    let textLines = [];
                                    let dates = Object.keys(songsByDate).sort((a, b) => new Date(b) - new Date(a));

                                    for (let date of dates) {
                                        textLines.push(`${date}:\n`);
                                        textLines.push(songsByDate[date].join('\n'));
                                        textLines.push('\n\n'); // Add extra newline for separation
                                    }

                                    // Update the fourth last tile
                                    const updatedTileList = [...homeJson.tileList];
                                    updatedTileList[updatedTileList.length - 4] = {
                                        "__class": "HomeService::HomeTile",
                                        "type": 2,
                                        "creationTime": Date.now(),
                                        "locked": false,
                                        "new": true,
                                        "lockDuration": 0,
                                        "contentExpiry": 0,
                                        "uuid": "00000000-0000-0000-0000-000000000000",
                                        "newsTileInfo": {
                                            "__class": "HomeService::NewsTileInfo",
                                            "type": 0,
                                            "title": "Latest Songs Added!",
                                            "text": textLines.join(''),                                          
					    "imageUrl": "https://jdmo-cdn.c0llydoll.com/public/homedb/home_tile_asset_article_hanabi_y4.png",
                                            "winnerPid": "00000000-0000-0000-0000-000000000000",
                                            "winnerPlatform": "",
                                            "winnerName": "",
                                            "winnerNameSuffix": 0,
                                            "winnerCountry": 4294967295,
                                            "winnerAvatar": 4294967295,
                                            "winnerAlias": 4294967295,
                                            "offlineNewID": ""
                                        }
                                    };

                                    // Existing code to update the last three tiles...

                                    // Get a random playlist ID
                                    const randomPlaylistID = getRandomPlaylistID(playlistJson.db);

                                    // Get a random map name and the last map name from jdmelody-nx-all.json
                                    const randomMapName = getRandomMapName(jdmelodyJson);
                                    const lastMapName = getLastMapName(jdmelodyJson);

                                    // Update the last three tiles in the tileList
                                    updatedTileList[updatedTileList.length - 3] = {
                                        "__class": "HomeService::HomeTile",
                                        "type": 1,
                                        "playlistTileInfo": {
                                            "__class": "HomeService::PlaylistTileInfo",
                                            "type": 0,
                                            "playlistID": "JustDance2026"
                                        },
                                        "creationTime": Date.now(),
                                        "new": true
                                    };

                                    updatedTileList[updatedTileList.length - 2] = {
                                        "__class": "HomeService::HomeTile",
                                        "type": 0,
                                        "creationTime": Date.now(),
                                        "locked": false,
                                        "new": false,
                                        "lockDuration": 0,
                                        "contentExpiry": 0,
                                        "uuid": "00000000-0000-0000-0000-000000000000",
                                        "mapTileInfo": {
                                            "__class": "HomeService::MapTileInfo",
                                            "type": 6,
                                            "mapName": randomMapName
                                        }
                                    };

                                    updatedTileList[updatedTileList.length - 1] = {
                                        "__class": "HomeService::HomeTile",
                                        "type": 0,
                                        "creationTime": Date.now(),
                                        "locked": false,
                                        "new": true,
                                        "lockDuration": 0,
                                        "contentExpiry": 0,
                                        "uuid": "00000000-0000-0000-0000-000000000000",
                                        "mapTileInfo": {
                                            "__class": "HomeService::MapTileInfo",
                                            "type": 1,
                                            "mapName": lastMapName
                                        }
                                    };

                                    homeJson.tileList = updatedTileList;

                                    res.status(200).json(homeJson);

                                }).catch(err => {
                                    logger.error('Error processing file stats:', err);
                                    return res.status(500).json({
                                        status: 500,
                                        error: 'Internal Server Error'
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});

const getTopPlayedMaps = async (limit = 10) => {
  const maps = await MapPlayedCount.aggregate([
    {
      $project: {
        mapName: 1,
        totalCount: {
          $reduce: {
            input: { $objectToArray: "$mapCountByCountry" },
            initialValue: 0,
            in: { $add: ["$$value", "$$this.v"] }
          }
        }
      }
    },
    { $sort: { totalCount: -1 } },
    { $limit: limit }
  ]);

  return maps.map(map => map.mapName); // Return only the map names
};

const getTopPlayedMapsByCountry = async (country, limit = 10) => {
  const maps = await MapPlayedCount.aggregate([
    {
      $project: {
        mapName: 1,
        countryCount: { $ifNull: [`$mapCountByCountry.${country}`, 0] } 
      }
    },
    { $match: { countryCount: { $gt: 0 } } },
    { $sort: { countryCount: -1 } }, 
    { $limit: limit } // Limit to the top N maps
  ]);

  return maps.map(map => map.mapName); // Return only the map names
};

router.get('/playlistdb/v1/playlists', validator, rateLimitMiddleware, async (req, res) => {
  const filePath = path.resolve(__dirname, '../data/playlistdb/playlist.json');
  const token = req.headers.authorization.substring(7, 257);
  const tokenKey = `validatedTokens:${token}`;
  const tokenDataRedis = await client.get(tokenKey);
  let tokenData;
  if (tokenDataRedis) {
      tokenData = JSON.parse(tokenDataRedis);
  } else {
      logger.error(`Profile System DOTW : Token header not found`);
      return res.status(401).json({
      status: 401,
      error: 'Unauthorized'
   });
  }
  const country = tokenData.Country || "US"; 

  try {
    // Check if the file exists
    await fs.promises.access(filePath, fs.constants.F_OK);

    // Read the playlist JSON file
    const playlistData = JSON.parse(await fs.promises.readFile(filePath, 'utf-8'));

    // Get the top played maps worldwide
    const topPlayedMaps = await getTopPlayedMaps(10); // Limit to 10 maps

    // Update the "reco-top_played" playlist
    if (playlistData.db['reco-top_played']) {
      playlistData.db['reco-top_played'].maps = topPlayedMaps;
    }

    // Get the top played maps for the specific country
    const topPlayedMapsByCountry = await getTopPlayedMapsByCountry(country, 10); // Limit to 10 maps

    // Update the "top_country" playlist
    if (!playlistData.db['reco-top_country']) {
      playlistData.db['reco-top_country'] = {
        maps: [],
        colors: {
          base_color: '5FB61EFF',
          grad_color: '17CDBAFF'
        },
        type: 'recommended',
        __class: 'PlaylistDbService::Playlist',
        title: `Top Played in ${country}`,
        description: `The most popular songs in your country!`,
        fixedMapOrder: false,
        fallback: false,
        pinned: false
      };
    }
    playlistData.db['reco-top_country'].maps = topPlayedMapsByCountry;

    // Send the updated playlist data as the response
    res.status(200).json(playlistData);
  } catch (error) {
    if (error.code === 'ENOENT') {
      // If the file does not exist
      logger.error('HomeDB Module: playlist.json file is not present');
      return res.status(404).json({
        status: 404,
        error: 'Not Found',
      });
    }

    // Handle other errors
    logger.error('Error reading or updating playlist data:', error);
    res.status(500).json({
      status: 500,
      error: 'Internal Server Error',
    });
  }
});
router.post('/carousel/v2/pages/anthology', validator, rateLimitMiddleware, (req, res) => {
	const filePath = path.join(__dirname, '../data/carouseldb/anthology.json');

	fs.readFile(filePath, 'utf8', (err, data) => {
		if (err) {
			logger.error('Carousel System Error: Error reading current carousel anthology file. check Error: ', err);
			return res.status(500).json({
				status: 500,
				error: 'Internal Server Error'
			});
		}

		try {
			const jsonData = JSON.parse(data);
			res.status(200).json(jsonData);
		} catch (parseError) {
			logger.error('Carousel System Error: Error parsing current carousel anthology file. check Error: ', parseError);
			return res.status(500).json({
				status: 500,
				error: 'Internal Server Error'
			});
		}
	});
});

router.post('/carousel/v2/pages/ftue', validator, rateLimitMiddleware, (req, res) => {
	res.status(500).json({
		status: 500,
		error: 'Internal Server Error'
	});
});

router.post('/carousel/v2/pages/jd2022-playlists',validator, rateLimitMiddleware, (req, res) => {
	const filePath = path.resolve(__dirname, '../data/playlistdb/jdmelody-playlists.json');

	fs.access(filePath, fs.constants.F_OK, (err) => {
		if (err) {
			// If the file does not exist, send a 404 error
			logger.error('HomeDB Module: jdmelody-playlists.json file is not present');
			return res.status(404).json({
						status: 404,
						error: 'Not Found'
					});
		}

		// If the file exists, send it
		res.status(200).sendFile(filePath);
	});
});

router.post('/carousel/v2/pages/jd2021-playlists', validator,rateLimitMiddleware, (req, res) => {
	const filePath = path.resolve(__dirname, '../data/playlistdb/jdmelody-playlists.json');

	fs.access(filePath, fs.constants.F_OK, (err) => {
		if (err) {
			// If the file does not exist, send a 404 error
			logger.error('playlist carousel file is not present');
			return res.status(404).send('Not Found');
		}

		// If the file exists, send it
		res.status(200).sendFile(filePath);
	});
});
router.post('/carousel/v2/pages/jd2020-playlists', validator,rateLimitMiddleware, (req, res) => {
	const filePath = path.resolve(__dirname, '../data/playlistdb/jdmelody-playlists.json');

	fs.access(filePath, fs.constants.F_OK, (err) => {
		if (err) {
			// If the file does not exist, send a 404 error
			logger.error('HomeDB Module: jdmelody-playlists.json file is not present');
			return res.status(404).json({
						status: 404,
						error: 'Not Found'
					});
		}

		// If the file exists, send it
		res.status(200).sendFile(filePath);
	});
});
router.post('/carousel/v2/pages/jd2019-playlists', validator, rateLimitMiddleware, (req, res) => {
	const filePath = path.resolve(__dirname, '../data/playlistdb/jdmelody-playlists.json');

	fs.access(filePath, fs.constants.F_OK, (err) => {
		if (err) {
			// If the file does not exist, send a 404 error
			logger.error('HomeDB Module: jdmelody-playlists.json file is not present');
			return res.status(404).json({
						status: 404,
						error: 'Not Found'
					});
		}

		// If the file exists, send it
		res.status(200).sendFile(filePath);
	});
});
router.post('/carousel/v2/pages/quests', validator, rateLimitMiddleware, (req, res) => {
	const filePath = path.join(__dirname, '../data/carouseldb/quests.json');

	fs.readFile(filePath, 'utf8', (err, data) => {
		if (err) {
			logger.error('Carousel System Error: Error reading current carousel quests file. check Error: ', err);
			return res.status(500).json({
				status: 500,
				error: 'Internal Server Error'
			});
		}

		try {
			const jsonData = JSON.parse(data);
			res.status(200).json(jsonData);
		} catch (parseError) {
			logger.error('Carousel System Error: Error parsing current carousel quests file. check Error: ', parseError);
			return res.status(500).json({
				status: 500,
				error: 'Internal Server Error'
			});
		}
	});
});

module.exports = router;
