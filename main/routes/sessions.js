const express = require('express');
const axios = require('axios');
const fs = require('fs');
const router = express.Router();
const path = require('path');
const rateLimitMiddlewareSessions = require("../ratelimit/rate-limiter-sessions");
const tokens429File = '429Tokens.json';
const logger = require("../logger/logger");
const redis = require('redis');
const config = require('config');
const crypto = require('crypto');
const isDevEnabled = config.get('EnvironmentsAccess.DevEnvironment');
const isPublicEnabled = config.get('EnvironmentsAccess.PublicEnvironment');
const isPatreonEnabled = config.get('EnvironmentsAccess.PatreonEnvironment');
const isDatabaseEnabled = config.get('EnvironmentsAccess.DatabaseUpdate');
const { generateToken } = require('./lib/jwtUtils');
const {
	createClient
} = require('@redis/client');

const redisUrl = 'redis://127.0.0.1:6379';

const client = createClient({
	url: redisUrl
});
const User = require('./model/User');
client.on('error', (err) => {
	logger.error(err, 'Session Module: Redis client error:');
});

client.connect().then(() => {
	logger.info('Session Module: Redis client connected');
}).catch(err => {
	logger.error(err, 'Failed to connect to Redis:');
});
const allowedGames = {
    "34ad0f04-b141-4793-bdd4-985a9175e70d": "jd2022-nx-all",
    "6e8a0cf3-c60e-44da-984c-7f8d7e1f4157": "jd2022-ps4-all",
	"778c0fff-db09-4c65-bcf0-84a40170c1d2": "jd2021-nx-all",
	"63475868-1e27-45c2-95c4-cfc58c951016": "jd2021-ps4-all",
	"b9363005-413a-436d-a75c-99c2d7a5d0de": "jd2020-nx-all",
	"71a93f8c-7b00-47ca-a2de-7dbf8de5a5d3": "jd2020-ps4-all",
	"848e9f13-07c1-41ae-baef-57bb9f4ac899": "jd2019-nx-all",
	"46f44bb2-76f0-450b-8114-280e8b12b013": "jd2019-ps4-all",
	"341789d4-b41f-4f40-ac79-e2bc4c94ead4": "jdmelody-pc-all",
	"338f2a70-2587-44ee-a64b-5dbe112fb043": "jd2018-ps4-all",
	"5cffd9b7-d56c-448c-9063-32190909d6e4" : "jd2017-ps4-cn",
	"853badc5-e5b8-47a9-be06-630a1071701c": "jd2018-nx-all",
	"d03d28dd-4706-4808-ba6d-13f43ba62a11": "jd2017-ps4-all",
	"cd0fcaad-e5e0-4996-a13a-5922362ced7a": "jd2016-ps4-all",
	"613fe1a7-86c6-4fa7-bfb3-230e92ae29d3": "jd2017-nx-all",
	"77b6223b-eb41-4ccd-833c-c7b16537fde3": "jdnext-nx-all",
	"a92e073a-b30d-49b1-98b8-2ddd705a43da": "jdnext-ps5-all"
};
const allowedGamesDev = {
    "34ad0f04-b141-4793-bdd4-985a9175e70d": "jd2022-nx-all",
    "6e8a0cf3-c60e-44da-984c-7f8d7e1f4157": "jd2022-ps4-all",
	"778c0fff-db09-4c65-bcf0-84a40170c1d2": "jd2021-nx-all",
	"63475868-1e27-45c2-95c4-cfc58c951016": "jd2021-ps4-all",
	"b9363005-413a-436d-a75c-99c2d7a5d0de": "jd2020-nx-all",
	"5cffd9b7-d56c-448c-9063-32190909d6e4" : "jd2017-ps4-cn",
	"71a93f8c-7b00-47ca-a2de-7dbf8de5a5d3": "jd2020-ps4-all",
	"848e9f13-07c1-41ae-baef-57bb9f4ac899": "jd2019-nx-all",
	"46f44bb2-76f0-450b-8114-280e8b12b013": "jd2019-ps4-all",
	"341789d4-b41f-4f40-ac79-e2bc4c94ead4": "jdmelody-pc-all",
	"338f2a70-2587-44ee-a64b-5dbe112fb043": "jd2018-ps4-all",
	"853badc5-e5b8-47a9-be06-630a1071701c": "jd2018-nx-all",
	"d03d28dd-4706-4808-ba6d-13f43ba62a11": "jd2017-ps4-all",
	"613fe1a7-86c6-4fa7-bfb3-230e92ae29d3": "jd2017-nx-all",
	"cd0fcaad-e5e0-4996-a13a-5922362ced7a": "jd2016-ps4-all",
	"77b6223b-eb41-4ccd-833c-c7b16537fde3": "jdnext-nx-all",
	"a92e073a-b30d-49b1-98b8-2ddd705a43da": "jdnext-ps5-all"
};
const allowedGamesPatreon = {
    "34ad0f04-b141-4793-bdd4-985a9175e70d": "jd2022-nx-all",
    "6e8a0cf3-c60e-44da-984c-7f8d7e1f4157": "jd2022-ps4-all",
	"778c0fff-db09-4c65-bcf0-84a40170c1d2": "jd2021-nx-all",
	"63475868-1e27-45c2-95c4-cfc58c951016": "jd2021-ps4-all",
	"b9363005-413a-436d-a75c-99c2d7a5d0de": "jd2020-nx-all",
	"341789d4-b41f-4f40-ac79-e2bc4c94ead4": "jdmelody-pc-all",
	"71a93f8c-7b00-47ca-a2de-7dbf8de5a5d3": "jd2020-ps4-all",
	"848e9f13-07c1-41ae-baef-57bb9f4ac899": "jd2019-nx-all",
	"46f44bb2-76f0-450b-8114-280e8b12b013": "jd2019-ps4-all",
	"338f2a70-2587-44ee-a64b-5dbe112fb043": "jd2018-ps4-all",
	"853badc5-e5b8-47a9-be06-630a1071701c": "jd2018-nx-all",
	"d03d28dd-4706-4808-ba6d-13f43ba62a11": "jd2017-ps4-all",
	"613fe1a7-86c6-4fa7-bfb3-230e92ae29d3": "jd2017-nx-all",
	"cd0fcaad-e5e0-4996-a13a-5922362ced7a": "jd2016-ps4-all",
	"77b6223b-eb41-4ccd-833c-c7b16537fde3": "jdnext-nx-all",
	"a92e073a-b30d-49b1-98b8-2ddd705a43da": "jdnext-ps5-all"
};
const allowedGamesPublic = {
    "34ad0f04-b141-4793-bdd4-985a9175e70d": "jd2022-nx-all",
    "6e8a0cf3-c60e-44da-984c-7f8d7e1f4157": "jd2022-ps4-all",
	"778c0fff-db09-4c65-bcf0-84a40170c1d2": "jd2021-nx-all",
	"63475868-1e27-45c2-95c4-cfc58c951016": "jd2021-ps4-all",
	"b9363005-413a-436d-a75c-99c2d7a5d0de": "jd2020-nx-all",
	"71a93f8c-7b00-47ca-a2de-7dbf8de5a5d3": "jd2020-ps4-all",
	"341789d4-b41f-4f40-ac79-e2bc4c94ead4": "jdmelody-pc-all",
	"848e9f13-07c1-41ae-baef-57bb9f4ac899": "jd2019-nx-all",
	"46f44bb2-76f0-450b-8114-280e8b12b013": "jd2019-ps4-all",
	"77b6223b-eb41-4ccd-833c-c7b16537fde3": "jdnext-nx-all",
	"a92e073a-b30d-49b1-98b8-2ddd705a43da": "jdnext-ps5-all"
};
const allowedGamesBan = {};
const ENDPOINTS = {
  PRODUCTION: 'http://jd-api-backup.azure-api.net/ubi/v3/profiles/sessions',
  PUBLIC: 'https://msr-public-ubiservices.ubi.com/v3/profiles/sessions',
  CHINA: 'https://public-ubiservices.jd.ubisoft.cn/v3/profiles/sessions',
  PRODUCTION_V2: 'http://jd-api-backup.azure-api.net/ubi/v2/profiles/sessions',
  PUBLIC_V2: 'https://msr-public-ubiservices.ubi.com/v2/profiles/sessions',
  CHINA_V2: 'https://public-ubiservices.jd.ubisoft.cn/v2/profiles/sessions'
};


const PLATFORM_TYPES = {
  DEFAULT: 'uplay',
  PSN: 'psn'
};

class ApiRequestHandler {
  constructor(logger) {
    this.logger = logger;
    this.tokens429File = 'tokens429.json';
  }

  async makeApiRequest(url, token, platformType, gameHeader) {
    try {
      return await axios.post(url, {}, {
        headers: {
          'Authorization': token,
          'ubi-appid': gameHeader,
          'ubi-requestedplatformtype': platformType,
        },
        timeout: 5000 
      });
    } catch (error) {
      this.logger.error(`API Request failed: ${error.message}`);
      throw error;
    }
  }

  async handle401Error(authHeader, gameHeader) {
    this.logger.info('Session System Warning: No Ubisoft Account, trying switch platform type');
    
    try {
      return await this.makeApiRequest(
        ENDPOINTS.PUBLIC,
        authHeader,
        PLATFORM_TYPES.DEFAULT,
        gameHeader
      );
    } catch (error) {
      if (error.response?.status === 401) {
        this.logger.info('Profile System Warning: Trying PSN platform type as last attempt');
        return await this.makeApiRequest(
          ENDPOINTS.PUBLIC,
          authHeader,
          PLATFORM_TYPES.PSN,
          gameHeader
        );
      }
      throw error;
    }
  }

  async recordBlockedToken(authHeader) {
    try {
      const tokens429Data = fs.existsSync(this.tokens429File) 
        ? JSON.parse(await fs.promises.readFile(this.tokens429File, 'utf8'))
        : {};
      
      tokens429Data[authHeader] = { timestamp: new Date().toISOString() };
      
      await fs.promises.writeFile(
        this.tokens429File,
        JSON.stringify(tokens429Data, null, 2),
        'utf8'
      );
      
      this.logger.warn('Session System Warning: New blocked token detected, saving to tokens429.json');
    } catch (error) {
      this.logger.error(`Failed to record blocked token: ${error.message}`);
    }
  }

  async handle429Error(authHeader, gameHeader, platformRequested) {
    this.logger.info('Session System Warning: Reached Azure Services. Level 2');

    try {
      return await this.makeApiRequest(
        ENDPOINTS.PRODUCTION,
        authHeader,
        platformRequested,
        gameHeader
      );
    } catch (error) {
      if (error.response?.status === 429) {
        const errorMessage = error.response.data.message;
        
        if (errorMessage === "Too many calls per profile.") {
          await this.recordBlockedToken(authHeader);
          throw new Error('Too Many Requests (Profile)');
        }
        
        if (errorMessage === "Too many calls per IP address.") {
          this.logger.warn('Session System Warning: Reached Ubisoft CN Services. Level 3');
          return await this.makeApiRequest(
            ENDPOINTS.CHINA,
            authHeader,
            platformRequested,
            gameHeader
          );
        }
      }
      throw error;
    }
  }

  async request(authHeader, gameHeader, platformRequested,isJD16) {
    try {
      const productionEndpoint = isJD16 ? ENDPOINTS.PRODUCTION_V2 : ENDPOINTS.PRODUCTION;
      return await this.makeApiRequest(
        productionEndpoint,
        authHeader,
        platformRequested,
        gameHeader
      );
    } catch (error) {
      if (error.response?.status === 401) {
        return await this.handle401Error(authHeader, gameHeader);
      }
      
      if (error.response?.status === 429) {
        return await this.handle429Error(authHeader, gameHeader, platformRequested);
      }
      
      // Final fallback attempt
      this.logger.warn('Session System Warning: Unknown Error, trying a second attempt');
      const publicEndpoint = isJD16 ? ENDPOINTS.PUBLIC_V2 : ENDPOINTS.PUBLIC;
      return await this.makeApiRequest(
        publicEndpoint,
        authHeader,
        platformRequested,
        gameHeader
      );
    }
  }
}

const prefixes = ["jd2018", "jd2017", "jd2016","jdmelody"];
const apiHandler = new ApiRequestHandler(logger);

const  validateSessionMiddleware = async (req, res, next) => {
	try {
		const authHeader = req.headers.authorization;
		const gameHeader = req.headers['ubi-appid'];
		const azureHeader = req.headers['x-azure-access'] || "N/A";
		const ip = req.ip;
		let Fixedip;
		if (ip.startsWith('::ffff:')) {
			Fixedip = ip.substring(7);
		}
		let clientIp = Fixedip;
		let clientIpCountry = null;
		//Crack user flow
		if (authHeader == 'uplaypc_v1 t=081f63bc-2666-461a-a7b3-4340bdbc6566'){
			if (azureHeader != 'cW2wTDiXCrroLIXfCqZusJkMSCw3AI0L')
			{
				return res.status(401).json({});
			}
			const randomProfileID = crypto.randomUUID();
			const randomName = 'JDMOCrackUser' + Math.floor(Math.random() * 1000) + 1
			const currentTime = new Date();
			const serverTime = currentTime.toISOString();
			const sessionId = crypto.randomUUID();
			const expiryDate = new Date(new Date().setHours(currentTime.getHours() + 3));
			const payload = {
				profileId: randomProfileID,
				environment: 'Crack',
				nameOnPlatform: randomName
				
			}
			const token = generateToken(payload);
			const responseTest = {
				platformType: 'uplay',
				profileId: randomProfileID,
				userId: 'JDMCrack-Free-User-Data-Informationn',
				nameOnPlatform: randomName,
				environment: 'Prod',
				spaceId: 'f1ae5b84-db7c-481e-9867-861cf1852dc8',
				clientIp: clientIp || null,
				clientIpCountry: '-',
				ticket: token,
				serverTime: serverTime,
				expiration: expiryDate,
				sessionId,
				sessionKey: 'UWU',
			}
			const tokenPart = token.substring(0, 250);
			const tokenKey = `validatedTokens:${tokenPart}`;
			const tokenData = {
					"ProfileId": randomProfileID,
					"Username": randomName,
					"Country": clientIpCountry,
					"X-Sku": allowedGames[gameHeader],
					"Environment": "Crack",
					"isBanned": false,
					"PlatformType": 'uplay',
					"SessionStartTime": new Date().toISOString()
				};
				await client.set(tokenKey, JSON.stringify(tokenData), {
					EX: 10800
				});
			logger.info(`Session System: New Session for ${randomName} Crack player in ${allowedGames[gameHeader]}`);
			return res.status(200).json(responseTest);
		}
		let userDatabase = {};

		
		
		if (!allowedGames[gameHeader]) {
			return res.status(403).json({ status: 403, error: 'Game Not Supported Gamed' });
		}
		const platformRequested = req.headers['ubi-requestedplatformtype'] || "uplay";
		let isJD16;
		if (gameHeader=="cd0fcaad-e5e0-4996-a13a-5922362ced7a") {
			isJD16 = true;
		} else {
			isJD16 = false;
		}
		let AppId;
		if (prefixes.some(prefix => allowedGames[gameHeader].startsWith(prefix))) {
			AppId = "210da0fb-d6a5-4ed1-9808-01e86f0de7fb";
		} else {
			AppId = gameHeader;
		}
		

		const tokens429Data = fs.existsSync(tokens429File) ? JSON.parse(fs.readFileSync(tokens429File, 'utf8')) : {};
		if (tokens429Data[authHeader]) {
			logger.warn(`An user who is blocked by ubiservices for many profiles calls tried was detected, avoiding calling ubiservices`);
			return res.status(429).json({
				status: 429,
				error: 'Too Many Attempts'
			});
		}
	  
		let apiResponse;
		try {
			apiResponse = await apiHandler.request(authHeader, AppId, platformRequested,isJD16);
		} catch (error) {
			logger.error(error, 'Session System Error: Error on Ubiservices Call.')
		}
		
		const userId = apiResponse.data.userId;
		const profileId = apiResponse.data.profileId;
		const platformType = apiResponse.data.platformType;
		const userName = apiResponse.data.nameOnPlatform;
		const user = await User.findOne({ profileId });
		const finalToken = apiResponse.data.ticket;
		const tokenPart = finalToken.substring(0, 250);
		try {
			const locationResponse = await fetch(`https://ipinfo.io/${Fixedip}/json`);
			const locationData = await locationResponse.json();

			if (locationData && locationData.country) {
				clientIp = locationData.ip;
				clientIpCountry = locationData.country || "US";
				apiResponse.data.clientIp = clientIp;
				apiResponse.data.clientIpCountry = clientIpCountry;
			} else {
				logger.warn(`Session System Ip Error : ${Fixedip}`);
			}
		} catch (error) {
			logger.error(error, `Session System Ip Error : ${Fixedip}`);
		}
		if (user) {
			user.userName = userName;
			user.lastTimeLogged = new Date();
			await user.save();
			
			if (user.isPatreon) {
				if (!isPatreonEnabled) {
					logger.warn(`Session System: an user: ${userName} tried to access in ${allowedGames[gameHeader]} but Patreon environment is disabled in config file, access forbidden`);
					return res.status(403).json({
						status: 403,
						error: 'Forbidden'
					});
				}
				if (!allowedGamesPatreon[gameHeader]) {
					return res.status(403).json({ status: 403, error: 'Not Supported Gamed Yet' });
				}
				const tokenKey = `validatedTokens:${tokenPart}`;
				const tokenData = {
					"ProfileId": profileId,
					"Username": userName,
					"Country": clientIpCountry,
					"X-Sku": allowedGamesPatreon[gameHeader],
					"Environment": "Patreon",
					"isBanned": false,
					"PlatformType": platformType,
					"SessionStartTime": new Date().toISOString()
				};
				await client.set(tokenKey, JSON.stringify(tokenData), {
					EX: 10800
				});
				logger.info(`Session System: New Session for ${userName} Patreon player in ${allowedGames[gameHeader]}`);
				return res.status(200).json(apiResponse.data);
			} else if (user.isDev) {
				if (!isDevEnabled) {
					logger.warn(`Session System: an user: ${userName} tried to access in ${allowedGames[gameHeader]} but developer environment is disabled in config file, access forbidden`);
					return res.status(403).json({
						status: 403,
						error: 'Forbidden'
					});
				}
				if (!allowedGamesDev[gameHeader]) {
					return res.status(403).json({ status: 403, error: 'Not Supported Gamed Yet' });
				}
				const tokenKey = `validatedTokens:${tokenPart}`;
				const tokenData = {
					"ProfileId": profileId,
					"Username": userName,
					"Country": clientIpCountry,
					"X-Sku": allowedGamesDev[gameHeader],
					"Environment": "Developer",
					"isBanned": false,
					"PlatformType": platformType,
					"SessionStartTime": new Date().toISOString()
				};
				await client.set(tokenKey, JSON.stringify(tokenData), {
					EX: 10800
				});
				logger.info(`Session System: New Session for ${userName} Developer player in ${allowedGames[gameHeader]}`);
				return res.status(200).json(apiResponse.data);
			} else if (user.isBanned) {
				if (!allowedGamesBan[gameHeader]) {
					return res.status(403).json({ status: 403, error: 'User Banned' });
				}
				const tokenKey = `validatedTokens:${tokenPart}`;
				const tokenData = {
					"ProfileId": profileId,
					"Username": userName,
					"Country": clientIpCountry,
					"X-Sku": allowedGamesBan[gameHeader],
					"Environment": "Restricted",
					"isBanned": true,
					"PlatformType": platformType,
					"SessionStartTime": new Date().toISOString()
				};
				await client.set(tokenKey, JSON.stringify(tokenData), {
					EX: 10800
				});
				logger.warn(`Session System: Banned User: ${userName} tried to play JDMO in ${allowedGames[gameHeader]}`);
				return res.status(403).json({
					status: 403,
					error: 'Forbidden'
				});
			} else {
				if (!isPublicEnabled) {
					logger.warn(`Session System: an user: ${userName} tried to access in ${allowedGames[gameHeader]} but public environment is disabled in config file, access forbidden`);
					return res.status(403).json({
						status: 403,
						error: 'Forbidden'
					});
				}
				if (!allowedGamesPublic[gameHeader]) {
					return res.status(403).json({ status: 403, error: 'Not Available Yet, Please consider get the patreon and dont proxy ur game.' });
				}
				const tokenKey = `validatedTokens:${tokenPart}`;
				const tokenData = {
					"ProfileId": profileId,
					"Username": userName,
					"Country": clientIpCountry,
					"X-Sku": allowedGamesPublic[gameHeader],
					"isBanned": false,
					"Environment": "Production",
					"PlatformType": platformType,
					"SessionStartTime": new Date().toISOString()
				};
				await client.set(tokenKey, JSON.stringify(tokenData), {
					EX: 10800
				});
				logger.info(`Session System: New Session for ${userName} (not Patreon) in ${allowedGamesPublic[gameHeader]}`);
				return res.status(200).json(apiResponse.data);
			}
		} else {
			if (!isDatabaseEnabled) {
				logger.warn(`Session System: an new user: ${userName} tried to access in ${allowedGames[gameHeader]} but saving user in database is disabled, access forbidden`);
				return res.status(403).json({
					status: 403,
					error: 'Forbidden'
				});
			}
			userNew = new User({
				"userId": userId,
				"profileId": profileId,
				"userName": userName,
				"isPatreon": false,
				"isBanned": false,
				"isDev": false,
				"platformType": platformType,
				"firstLoginTime": new Date(),
				"lastTimeLogged": new Date(),
				"dateSinceEnv": new Date()
			});
			await userNew.save();
			if (!isPublicEnabled) {
				logger.warn(`Session System: an user: ${userName} tried to access in ${allowedGames[gameHeader]} but public environment is disabled in config file, access forbidden, user added to database.`);
				return res.status(403).json({
					status: 403,
					error: 'Forbidden'
				});
			}
			if (!allowedGamesPublic[gameHeader]) {
					return res.status(403).json({ status: 403, error: 'Not Available Yet, Please consider get the patreon and dont proxy ur game.' });
				}
			const tokenKey = `validatedTokens:${tokenPart}`;
			const tokenData = {
				"ProfileId": profileId,
					"Username": userName,
					"Country": clientIpCountry,
					"X-Sku": allowedGamesPublic[gameHeader],
					"isBanned": false,
					"Environment": "Production",
					"PlatformType": platformType,
					"SessionStartTime": new Date().toISOString()
			};
			await client.set(tokenKey, JSON.stringify(tokenData), {
				EX: 10800
			});
			logger.info(`Session System: New Session for ${userName} (not Patreon) in ${allowedGames[gameHeader]}, user added to database.`);
			return res.status(200).json(apiResponse.data);
		}

		next();
	} catch (error) {
		logger.error(error, 'Session System: Error validating session:');
		res.status(500).json({
			status: 500,
			error: 'Internal Server Error'
		});
	}
};


const redirectMiddleware = (req, res) => {
	const newUrl = `http://jd-api-backup.azure-api.net${req.originalUrl}`;
	res.redirect(307, newUrl);
};


router.post('/v3/profiles/sessions', rateLimitMiddlewareSessions, validateSessionMiddleware);
router.post('/v3/profiles/sessions-pc', validateSessionMiddleware);
router.post('/v2/profiles/sessions', rateLimitMiddlewareSessions, validateSessionMiddleware);

module.exports = router;
