const express = require('express');
const router = express.Router();
const logger = require("../logger/logger");
const Dotw = require('./model/Dotw');
const { tokenType } = require('./lib/jwtUtils');
const validator = require("../logger/sessionvalidator");
const validators2s = require("../logger/sessionvalidator-s2s");
const rateLimitMiddleware = require("../ratelimit/rate-limiter-15");
const fs = require('fs');
const path = require('path');
const Leaderboard = require('./model/Leaderboard'); // Modelo de Mongoose
const axios = require('axios');
const {
	createClient
} = require('@redis/client');
const platformModels = {
	switch: './model/Leaderboard-switch',
	psn: './model/Leaderboard-psn',
	uplay: './model/Leaderboard-uplay',
};
const redisUrl = 'redis://127.0.0.1:6379';

const client = createClient({
	url: redisUrl
});

client.on('error', (err) => {
	logger.error(err,'Leaderboard System: Redis profile client error:');
});

client.connect().then(() => {
	logger.info('Leaderboard System:  Redis profile client connected');
}).catch(err => {
	logger.error(err,'Leaderboard System: Failed to connect to Redis:');
});
const redirectMiddleware = (req, res) => {
	const newUrl = `https://jd-api-backup-backup.azure-api.net${req.originalUrl}`;
	res.redirect(307, newUrl);
};
//dotw get
router.get('/leaderboard/v1/maps/:mapName/dancer-of-the-week', validators2s, rateLimitMiddleware, async (req, res) => {
  try {
    const mapName = req.params.mapName;

    const dotwData = await Dotw.findOne({ mapName },{_id:0,mapName:0,__v:false})
	
    if (dotwData) {
      res.status(200).json(dotwData);
    } else {
      res.status(200).json({ "__class": "DancerOfTheWeek" });
    }
  } catch (error) {
    console.error('Leaderboard System Dotw: Error accessing DOTW data:', error);
    res.status(500).json({
      status: 500,
      error: 'Internal Server Error'
    });
  }
});
const codenamesData = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/songdb/jdmelody-nx-dev.json'), 'utf8'));
const validSkus = ["jd2018-pc-dev","jdmelody-pc-all", "jd2018-nx-all", "jd2017-nx-all", "jd2018-ps4-scee", "jd2018-ps4-scea", "jd2017-ps4-scee", "jd2017-ps4-scea", "jd2016-ps4-scee", "jd2016-ps4-scea"];

const CONSTANTS = {
  TOKEN_SUBSTRING: { start: 7, end: 257 },
  MAX_SCORE: 13333,
  CONSOLE_CHARS: {
    nx: '[C:ffe60012]',
    ps4: '[C:ff2e6db4]⅝ '
  }
};

class ProfileError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'ProfileError';
  }
}

const getConsoleChar = (skuid) => {
  if (skuid.includes('nx')) return CONSTANTS.CONSOLE_CHARS.nx;
  if (skuid.includes('ps4')) return CONSTANTS.CONSOLE_CHARS.ps4;
  return '';
};

const validateToken = async (token) => {
  if (!token) throw new ProfileError('No authorization token provided', 401);
  
  const tokenKey = `validatedTokens:${token}`;
  const tokenDataRedis = await client.get(tokenKey);
  
  if (!tokenDataRedis) {
    throw new ProfileError('Invalid or expired token', 401);
  }
  
  return JSON.parse(tokenDataRedis);
};

const fetchProfileData = async (profileId, headers) => {
  try {
    const [accountResponse, profileResponse] = await Promise.all([
      axios.post('https://jd-api-backup.azure-api.net/account/v1/accounts', {}, { headers }),
      axios.get(`https://jd-api-backup.azure-api.net/profile/v2/profiles?profileIds=${profileId}`, { headers })
    ]);

    if (!Array.isArray(profileResponse.data) || profileResponse.data.length === 0) {
      throw new ProfileError('No profile data found', 404);
    }

    return {
      accountData: accountResponse.data,
      profileData: profileResponse.data[0]
    };
  } catch (error) {
    throw new ProfileError(`Error fetching profile data: ${error.message}`, error.response?.status || 500);
  }
};

const updateLeaderboard = async (platform, profileId, scoreData, profileInfo) => {
  const modelPath = platformModels[platform];
  if (!modelPath) {
    throw new ProfileError(`Unsupported platform type: ${platform}`, 400);
  }

  let Leaderboard;
  try {
    Leaderboard = require(modelPath);
  } catch (err) {
    throw new ProfileError(`Error loading leaderboard model: ${err.message}`, 500);
  }

  const leaderboardUpdates = Object.entries(scoreData)
    .filter(([codename, data]) => {
      return codenamesData[codename] && data.highest <= CONSTANTS.MAX_SCORE;
    })
    .map(([codename, data]) => updateSingleLeaderboard(
      Leaderboard,
      codename,
      profileId,
      data.highest,
      profileInfo
    ));

  await Promise.all(leaderboardUpdates);
};

const updateSingleLeaderboard = async (Leaderboard, codename, profileId, score, profileInfo) => {
  const leaderboard = await Leaderboard.findOne({ Codename: codename }) || 
                     new Leaderboard({ Codename: codename, entries: [] });

  const playerEntry = {
    profileId,
    score,
    ...profileInfo
  };

  const existingEntryIndex = leaderboard.entries.findIndex(entry => entry.profileId === profileId);
  
  if (existingEntryIndex !== -1) {
    leaderboard.entries[existingEntryIndex] = playerEntry;
  } else {
    leaderboard.entries.push(playerEntry);
  }

  leaderboard.entries.sort((a, b) => b.score - a.score);
  leaderboard.entries.forEach((entry, index) => {
    entry.rank = index + 1;
  });

  await leaderboard.save();
};
async function updateDotwProfile(pid, data, consoleChar) {
	const {
		avatar,
		country,
		alias,
		aliasGender,
		portraitBorder,
		jdPoints
	} = data;
	name = consoleChar + data.name;
	if (!pid) {
		throw new Error('PID is required.');
	}

	const result = await Dotw.updateMany({
			pid
		}, // Filter by pid
		{
			$set: {
				name,
				avatar,
				country,
				alias,
				aliasGender,
				portraitBorder,
				jdPoints
			}
		}
	);

	return result;
};
//leaderboard get
router.get('/leaderboard/v1/maps/:Codename/world', validators2s, rateLimitMiddleware, async (req, res) => {
    const { Codename } = req.params;
    const TOP_ENTRIES = 4;
    const TOTAL_ENTRIES = 5;

    var platformQuery = (["switch", "uplay", "psn"].includes(req.query.platform)) ? req.query.platform : "switch"; // Optional platform filter

    // Validate SKU
    const skuid = req.headers['x-skuid'];
    if (!validSkus.includes(skuid) && !req.sessionInfo?.isS2S) {
        return res.status(404).json({
            status: 404,
            message: 'Not found'
        });
    }

    try {
        // Token and profile validation
        const authorization = req.headers['authorization'];
        const token = authorization?.substring(7, 257) || "fake";
        var [profileDataRedis, tokenData] = await Promise.all([
            client.get(`userProfileData:${token}`),
            client.get(`validatedTokens:${token}`)
        ]);

        if ((!profileDataRedis || !tokenData) && !req.sessionInfo?.isS2S) {
            logger.error('Leaderboard System: Profile or token data not found in Redis');
            return res.status(404).json({
                status: 404,
                error: 'Not Found',
            });
        } else if (req.sessionInfo?.isS2S) {
          profileDataRedis = JSON.stringify({
            profileId: 's2s-profile',
            name: 'S2S User',
            avatar: '',
            country: '',
            skin: '',
            alias: '',
            aliasGender: 0,
            portraitBorder: 1,
            jdPoints: 0,
          });
          tokenData = JSON.stringify({
            PlatformType: platformQuery
          });
        }

        const userProfile = JSON.parse(profileDataRedis);
        const tokenInfo = JSON.parse(tokenData);
        const profileId = userProfile.profileId;
        const platform = tokenInfo.PlatformType;

        // Load platform-specific model
        let Leaderboard;
        try {
            Leaderboard = require(platformModels[platform]);
        } catch (err) {
            logger.error(`Error loading model for platform ${platform}: ${err.message}`);
            return res.status(500).json({
                status: 500,
                error: 'Internal Server Error1',
            });
        }

        // Get leaderboard data
        const leaderboard = await Leaderboard.findOne({ Codename }).lean();
        if (!leaderboard) {
            return res.status(404).json({
                status: 404,
                message: 'Not found'
            });
        }

        // Filter and sort entries
        const filteredEntries = platform ? 
            leaderboard.entries.filter(entry => entry.platform === platform) :
            leaderboard.entries;
        
        const sortedEntries = filteredEntries
            .sort((a, b) => b.score - a.score)
            .map((entry, index) => ({
                __class: "LeaderboardEntry_Online",
                profileId: entry.profileId,
                rank: index + 1,
                score: entry.score,
                name: entry.name,
                avatar: entry.avatar,
                country: entry.country,
                platformId: entry.platformId || "",
                ...(entry.alias && { alias: entry.alias }),
                ...(entry.aliasGender !== undefined && { aliasGender: entry.aliasGender }),
                jdPoints: entry.jdPoints || 0,
                portraitBorder: entry.portraitBorder || 1
            }));

        // send everything to s2s
        if (req.sessionInfo?.isS2S) {
            return res.json({
                __class: "LeaderboardList",
                entries: sortedEntries
            });
        }

        // Prepare response entries
        let responseEntries = [];
        const userPosition = sortedEntries.findIndex(entry => entry.profileId === profileId);
        
        if (userPosition === -1) {
            // User not found in leaderboard, return top 5
            responseEntries = sortedEntries.slice(0, TOTAL_ENTRIES);
        } else if (userPosition < TOP_ENTRIES) {
            // User is in top 4, return top 5
            responseEntries = sortedEntries.slice(0, TOTAL_ENTRIES);
        } else {
            // User is below top 4, return top 4 + user's position
            responseEntries = [
                ...sortedEntries.slice(0, TOP_ENTRIES),
                sortedEntries[userPosition]
            ];
        }

        res.json({
            __class: "LeaderboardList",
            entries: responseEntries
        });

    } catch (error) {
        logger.error('Leaderboard System: Unknown Error:', error);
        res.status(500).json({
            status: 500,
            message: 'Internal Server Error2' + error.stack
        });
    }
});
router.post('/profile/v2/profiles',
  validator,
  rateLimitMiddleware,
  async (req, res, next) => {
    const skuid = req.headers['x-skuid'];
	const token1 = req.headers.authorization
    const consoleChar = getConsoleChar(skuid);
    const tokenTypeMid = await tokenType(token1)
	if (tokenTypeMid=== 'Crack'){
		return res.status(200).json({});
	}
	if (tokenTypeMid=== 'Developer'){
		return res.status(200).json({});
	}

    // Function to handle the async processing
    const processProfileAsync = async () => {
      try {
        const token = req.headers.authorization.substring(
          CONSTANTS.TOKEN_SUBSTRING.start,
          CONSTANTS.TOKEN_SUBSTRING.end
        );
        const tokenData = await validateToken(token);

        // Handle non-valid SKUs
        if (!validSkus.includes(skuid)) {
          await updateDotwProfile(tokenData.ProfileId, req.body, consoleChar);
          logger.info(`Profile System DOTW: Updated Profile of the DOTW for user: ${tokenData.Username}`);
          return;
        }

        // Main flow for valid SKUs
        const { accountData, profileData } = await fetchProfileData(
          tokenData.ProfileId,
          {
            Authorization: req.headers.authorization,
            'x-skuid': req.headers['x-skuid']
          }
        );

        // Skip processing if conditions aren't met
        if (profileData.isExisting || !profileData.scores || Object.keys(profileData.scores).length === 0) {
          return;
        }

        const profileInfo = {
          name: profileData.name,
          avatar: profileData.avatar,
          country: profileData.country,
          skin: profileData.skin,
          alias: profileData.alias,
          aliasGender: profileData.aliasGender,
          portraitBorder: profileData.portraitBorder,
          jdPoints: profileData.jdPoints,
          platform: tokenData.PlatformType
        };

        await updateLeaderboard(
          tokenData.PlatformType,
          tokenData.ProfileId,
          req.body.scores,
          profileInfo
        );
        
        logger.info(`Leaderboard System: Scores Updated Correctly for ProfileId: ${tokenData.ProfileId} with UserName: ${profileData.name}`);
      } catch (error) {
        logger.error(error, 'Error in async profile processing:');
      
      }
    };

    try {
      res.redirect(307, `https://jd-api-backup.azure-api.net${req.originalUrl}`);
      
      // Process the request asynchronously after sending response
      processProfileAsync().catch(error => {
        logger.error(error, 'Unhandled error in async processing:');
      });
    } catch (error) {
      logger.error(error, 'Error in redirect:');
      const statusCode = error instanceof ProfileError ? error.statusCode : 500;
      res.status(statusCode).json({
        status: statusCode,
        error: error.message || 'Internal Server Error'
      });
    }
  },
  redirectMiddleware
);
router.post('/profile/v1/profiles', validator, rateLimitMiddleware, redirectMiddleware);

module.exports = router;