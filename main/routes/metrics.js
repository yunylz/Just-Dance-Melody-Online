const express = require('express');
const router = express.Router();
const logger = require("../logger/logger");
const {
	createClient
} = require('@redis/client');

// Initialize Redis client
const redisUrl = 'redis://127.0.0.1:6379';

const redisClient = createClient({
	url: redisUrl
});

// Connect to Redis
(async () => {
  try {
    await redisClient.connect();
    logger.info('Status Module: Connected to Redis');
  } catch (err) {
    logger.error(err,'Status Module: Could not connect to Redis:');
  }
})();

// Define the route handler
router.get('/status/v1/ccu', async (req, res) => {
  try {
    let keys = [];
    let cursor = 0;

       do {
      const { cursor: newCursor, keys: foundKeys } = await redisClient.scan(cursor, {
        MATCH: 'validatedTokens:*',
        COUNT: 1000
      });
      cursor = Number(newCursor);
      keys = keys.concat(foundKeys);
    } while (cursor !== 0);

    // Map to store data per unique pid
    const pidMap = new Map();

    // Get the current time
    const now = new Date();

    // Process each key to extract data, ensuring each pid is unique
    for (let key of keys) {
      try {
        const dataString = await redisClient.get(key);
        const data = JSON.parse(dataString);

        // Parse SessionStartTime and calculate the difference
        const sessionStartTime = new Date(data.SessionStartTime);
        const timeDifference = now - sessionStartTime; // Difference in milliseconds

        // Only consider sessions from the last hour (3600000 milliseconds)
        if (timeDifference > 10800000) {
          continue; // Skip this key if it's older than one hour
        }

        const pid = data.ProfileId;
        if (!pidMap.has(pid)) {
          pidMap.set(pid, data);
        }
        // If pid is already in the map, skip to ensure uniqueness
      } catch (err) {
        console.error(`Error processing key ${key}:`, err);
        continue; // Skip to the next key
      }
    }

    // Initialize counts
    const envCounts = {
      Dev: 0,
      Patreon: 0,
      Production: 0,
      Banned: 0
    };
    const platformCounts = {
      ps4: {
        jd2022: 0,
        jd2021: 0,
        jd2020: 0,
        jd2019: 0
      },
      nx: {
        jd2022: 0,
        jd2021: 0,
        jd2020: 0,
        jd2019: 0
      },
      pc: {
        jdmelody: 0
      }
    };

    // Aggregate counts based on unique pids
    for (const data of pidMap.values()) {
      // Environment count
      if (data.isBanned) {
        envCounts['Banned']++;
      } else if (envCounts.hasOwnProperty(data.Environment)) {
        envCounts[data.Environment]++;
      } else {
        envCounts[data.Environment] = 1;
      }

      // Platform and game version count
      const xSkuParts = data['X-Sku'].split('-');
      const gameVersion = xSkuParts[0]; // e.g., 'jd2020'
      const platformCode = xSkuParts[1]; // e.g., 'ps4'

      if (platformCounts.hasOwnProperty(platformCode)) {
        if (platformCounts[platformCode].hasOwnProperty(gameVersion)) {
          platformCounts[platformCode][gameVersion]++;
        } else {
          platformCounts[platformCode][gameVersion] = 1;
        }
      } else {
        platformCounts[platformCode] = { [gameVersion]: 1 };
      }
    }

    // Construct the response object
    const response = {
      TotalPlayers: pidMap.size,
      Envs: envCounts,
      Platform: platformCounts
    };

    res.status(200).json(response);
  } catch (err) {
    logger.error(err,'Metrics Module: Error fetching data:');
    res.status(500).json({
										status: 500,
										error: 'Internal Server Error'
									});
  }
});

// Export the router
module.exports = router;