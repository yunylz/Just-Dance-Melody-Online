const express = require('express');
const router = express.Router();
const fetch = require('node-fetch');
const axios = require('axios');
const fs = require('fs');
const validator = require("../logger/sessionvalidator");
const path = require('path');
const logger = require("../logger/logger");
const rateLimitMiddleware = require("../ratelimit/rate-limiter-profile");
const userDatabaseFile = 'userdatabase.json';
const tokens429File = '429Tokens.json';
const { tokenType } = require('./lib/jwtUtils');
const {
	createClient
} = require('@redis/client');
const Dotw = require('./model/Dotw');

const redisUrl = 'redis://127.0.0.1:6379';

const client = createClient({
	url: redisUrl
});

client.on('error', (err) => {
	logger.error('Profile System: Redis profile client error:', err);
});
const MapPlayedCount = require('./model/MapPlayedCount');
client.connect().then(() => {
	logger.info('Profile System:  Redis profile client connected');
}).catch(err => {
	logger.error('Profile System: Failed to connect to Redis:', err);
});

const readJsonFromRedis = async (key) => {
	const data = await client.get(key);
	return data ? JSON.parse(data) : {};
};
const writeJsonToRedis = async (key, jsonData) => {
	await client.set(key, JSON.stringify(jsonData));
};


const validSkus = ["jdmelody-pc-all", "jd2018-nx-all", "jd2017-nx-all","jd2018-ps4-scee","jd2018-ps4-scea","jd2017-ps4-scee","jd2017-ps4-scea","jd2016-ps4-scee","jd2016-ps4-scea"];

router.get('/profile/v2/profiles', validator, rateLimitMiddleware, async (req, res) => {
	try {
		let userDatabase = {};
		const profileId = req.query.profileIds;		
		const token = req.headers.authorization;
		const tokenEnv = await tokenType(token);
		if (tokenEnv==="Crack"){
			return res.status(200).json([{
			profileId: profileId || "",
			isExisting: false
		}]);
		}
		const tokens429Data = fs.existsSync(tokens429File) ? JSON.parse(fs.readFileSync(tokens429File, 'utf8')) : {};
		const tokenPart = token.substring(7, 257);
		if (tokens429Data[tokenPart]) {

			return res.status(429).json({
				status: 429,
				error: 'Too Many Requests'
			});
		}
		let headerCheck = req.headers['x-skuid']
		if (validSkus.includes(headerCheck)) {
			headerCheck = "jdcompanion-android"
			logger.info(`Profile System: Old game profile request detected! Setting SKU to ${headerCheck}`);
		}

	
		const tokenKey = `validatedTokens:${tokenPart}`;
		const tokenData = await client.get(tokenKey);
		const validatedToken = JSON.parse(tokenData);
		if (validatedToken.ProfileId === profileId) {
			const apiProfileResponse = await fetch(`https://jd-api-backup.azure-api.net/profile/v2/profiles?profileIds=${profileId}`, {
				headers: {
					authorization: req.headers.authorization,
					'user-agent': req.headers['user-agent'],
					'x-skuid': headerCheck
				}
			});

			if (!apiProfileResponse.ok) {
				throw new Error(`HTTP error! Status: ${apiProfileResponse.status}`);
			}

			// Convert the response to JSON
			const responseData = await apiProfileResponse.json();
			if (responseData[0].isExisting == false) {
				const newUrl = `https://jd-api-backup.azure-api.net${req.originalUrl}`;
				logger.warn(`Profile System: User with ProfileId ${responseData[0].profileId} does not exist in JMCS - Redirecting request`)
				return res.redirect(307, newUrl);
			}

			// Extract profileId from the response
			const fetchedProfileId = responseData[0].profileId;
			const profileName = responseData[0].name;
			const profileData = {
				name: responseData[0].name,
				profileId: responseData[0].profileId,
				avatar: responseData[0].avatar,
				skin: responseData[0].skin,
				jdPoints: responseData[0].jdPoints,
				platformId: responseData[0].platformId,
				alias: responseData[0].alias,
				aliasGender: responseData[0].aliasGender,
				country: responseData[0].country,
				portraitBorder: responseData[0].portraitBorder
			};
			// Save data to the unified JSON file
			const profileKey = `userProfileData:${tokenPart}`;
			await client.set(profileKey, JSON.stringify(profileData), {
					EX: 4500
				});
			logger.info(`Profile System: Saved ${profileName} temporal profile data`);

			let sessions = await readJsonFromRedis('wdfSessions');
			let sessionUpdated = false;
			for (const [key, value] of Object.entries(sessions)) {
				if (value.profileId === fetchedProfileId) {
					// Remove the old token
					delete sessions[key];
					// Insert new session with updated token
					sessions[tokenPart] = {
						...value,
						profileId: fetchedProfileId
					};
					sessionUpdated = true;
					await writeJsonToRedis('wdfSessions', sessions);
					logger.info(`Profile System: Updated wdfSession for username: ${profileName}`);
					break;
				}
			}

			// Load custom aliases
			const customAliasesPath = path.resolve(__dirname, '..', 'data', 'aliasdb', 'custom_aliases.json');
			const customAliases = JSON.parse(fs.readFileSync(customAliasesPath, 'utf8'));

			// Add custom aliases to profile to unlock them
			for (let i = 0; i < responseData.length; i++) {
				const profile = responseData[i];
				// If profile has aliases
				if (profile.unlockedAliases) {
					customAliases.forEach(alias => {
						// Check if alias is already unlocked
						if (!profile.unlockedAliases.some(unlocked => unlocked.id === alias.id)) {
							// Add custom alias to unlockedAliases in the response data
							responseData[i].unlockedAliases.push(alias.id)
						}
					})
				}
			}
			
			res.status(200).send(responseData);
		} else {
			const newUrl1 = `https://jd-api-backup.azure-api.net${req.originalUrl}`;
			logger.warn(`Profile System: User with ProfileId ${profileId} does not correspond to the token pid: ${validatedToken.ProfileId} - Redirecting request`)
			return res.redirect(307, newUrl1);
		}
	} catch (error) {
		logger.error(error, 'Profile System Error: Unknown Error');
		res.status(500).json({
			status: 500,
			error: 'Internal Server Error'
		});
	}
});
router.get('/profile/v1/profiles', validator, rateLimitMiddleware, async (req, res) => {
	try {
		let userDatabase = {};
		if (fs.existsSync(userDatabaseFile)) {
			userDatabase = JSON.parse(fs.readFileSync(userDatabaseFile, 'utf8'));
		} else {
			logger.error(`Profile System Error: ${userDatabaseFile} does not exist.`);
			return res.status(503).json({
				status: 503,
				error: 'Service unavailable'
			});
		}
		const profileId = req.query.profileIds || "empty";		
		const token = req.headers.authorization;
		const tokenEnv = await tokenType(token);
		if (tokenEnv==="Crack"){
			return res.status(200).json([{
			profileId: profileId || "",
			isExisting: false
		}]);
		}
		const tokens429Data = fs.existsSync(tokens429File) ? JSON.parse(fs.readFileSync(tokens429File, 'utf8')) : {};
		const tokenPart = token.substring(7, 257);
		if (tokens429Data[tokenPart]) {

			return res.status(429).json({
				status: 429,
				error: 'Too Many Requests'
			});
		}
		let headerCheck = req.headers['x-skuid']
		if (validSkus.includes(headerCheck)) {
			headerCheck = "jdcompanion-android"
			logger.info(`Profile System: old game profile request detected! Setting SKU to ${headerCheck}`);
		}

	
		const tokenKey = `validatedTokens:${tokenPart}`;
		const tokenData = await client.get(tokenKey);
		const validatedToken = JSON.parse(tokenData);
		if (validatedToken.ProfileId === profileId) {
			const apiProfileResponse = await fetch(`https://jd-api-backup.azure-api.net/profile/v1/profiles?profileIds=${profileId}`, {
				headers: {
					authorization: req.headers.authorization,
					'user-agent': req.headers['user-agent'],
					'x-skuid': headerCheck
				}
			});

			if (!apiProfileResponse.ok) {
				throw new Error(`Profile HTTP error! Status: ${apiProfileResponse.status}`);
			}

			// Convert the response to JSON
			const responseData = await apiProfileResponse.json();
			if (Array.isArray(responseData) && responseData.length === 0) {
				const newUrl = `https://jd-api-backup.azure-api.net${req.originalUrl}`;
				logger.warn(`Profile System: User with ProfileId ${responseData[0].profileId} does not exist in JMCS - Redirecting request`)
				return res.redirect(307, newUrl);
			}

			// Extract profileId from the response
			const fetchedProfileId = responseData[0].profileId;
			const profileName = responseData[0].name;
			const profileData = {
				name: responseData[0].name,
				profileId: responseData[0].profileId,
				avatar: responseData[0].avatar,
				platformId: responseData[0].platformId,
				alias: responseData[0].alias || null,
				aliasGender: responseData[0].aliasGender || null,
				country: responseData[0].country,
				portraitBorder: responseData[0].portraitBorder || null
			};
			// Save data to the unified JSON file
			const profileKey = `userProfileData:${tokenPart}`;
			await client.set(profileKey, JSON.stringify(profileData), {
					EX: 4500
				});
			logger.info(`Profile System: Saved ${profileName} temporal profile data`);

			let sessions = await readJsonFromRedis('wdfSessions');
			let sessionUpdated = false;
			for (const [key, value] of Object.entries(sessions)) {
				if (value.profileId === fetchedProfileId) {
					// Remove the old token
					delete sessions[key];
					// Insert new session with updated token
					sessions[tokenPart] = {
						...value,
						profileId: fetchedProfileId
					};
					sessionUpdated = true;
					await writeJsonToRedis('wdfSessions', sessions);
					logger.info(`Profile System: Updated wdfSession for username: ${profileName}`);
					break;
				}
			}

			// Load custom aliases
			const customAliasesPath = path.resolve(__dirname, '..', 'data', 'aliasdb', 'custom_aliases.json');
			const customAliases = JSON.parse(fs.readFileSync(customAliasesPath, 'utf8'));

			// Add custom aliases to profiles to unlock them
			for (let i = 0; i < responseData.length; i++) {
				const profile = responseData[i];
				// If profile has aliases
				if (profile.unlockedAliases) {
					customAliases.forEach(alias => {
						// Check if alias is already unlocked
						if (!profile.unlockedAliases.some(unlocked => unlocked.id === alias.id)) {
							// Add custom alias to unlockedAliases in the response data
							responseData[i].unlockedAliases.push(alias.id)
						}
					})
				}
			}
			
			res.status(200).send(responseData);
		} else {
			const newUrl1 = `https://jd-api-backup.azure-api.net${req.originalUrl}`;
			logger.warn(`Profile System: User with ProfileId ${profileId} does not correspond to the token pid: ${validatedToken.ProfileId} - Redirecting request`)
			return res.redirect(307, newUrl1);
		}
	} catch (error) {
		logger.error(error, 'Profile System Error: Unknown Error');
		res.status(500).json({
			status: 500,
			error: 'Internal Server Error'
		});
	}
});

const getCurrentScore = async (mapName) => {
  const dotwData = await Dotw.findOne({ mapName });
  return dotwData ? dotwData.score : 0;
};
const updateMapPlayedCount = async (mapName, countryCode) => {
  if (!mapName || !countryCode) {
    throw new Error('Token, mapName and countryCode are required');
  }

  const updatedMap = await MapPlayedCount.findOneAndUpdate(
    { mapName }, // Find by mapName
    { 
      $inc: { [`mapCountByCountry.${countryCode}`]: 1 } 
    },
    { new: true, upsert: true } 
  );

  return updatedMap;
};

router.post('/profile/v2/map-ended', validator, rateLimitMiddleware, async (req, res) => {
  try {
	const token2 = req.headers.authorization;
	const tokenEnv = await tokenType(token2);
	if (tokenEnv==="Crack"){
			return res.status(200).json({});
	}
    const token = req.headers.authorization.substring(7, 257); // Remove 'Ubi_v1 '
	
    const skuId = req.headers['x-skuid'];
    let consoleChar = '';

    if (skuId.includes('nx')) {
      consoleChar = '[C:ffe60012]';
    } else if (skuId.includes('ps4')) {
      consoleChar = '[C:ff2e6db4]⅝ ';
    }
	const profileKey = `userProfileData:${token}`;
	const profileDataRedis = await client.get(profileKey);
    if (profileDataRedis) {
      profileData = JSON.parse(profileDataRedis);
    } else {
      logger.error(`Profile System DOTW : Profile data not found`);
      return res.status(404).json({
      status: 404,
      error: 'Not Found'
    });
    }
	const tokenKey = `validatedTokens:${token}`;
	const tokenDataRedis = await client.get(tokenKey);
    if (tokenDataRedis) {
      tokenData = JSON.parse(tokenDataRedis);
    } else {
      logger.error(`Profile System DOTW : Token header not found`);
      return res.status(401).json({
      status: 401,
      error: 'Unauthorized'
    });
    }
	
    const mapEndedData = req.body[0];
	try {
		const updatedMap = await updateMapPlayedCount(mapEndedData.mapName, tokenData.Country);
	} catch (error) {
		logger.error(error,`Profile System DOTW : error updating map count`);
	}
    const currentScore = await getCurrentScore(mapEndedData.mapName); // Fetch score from MongoDB
    const newScore = parseInt(mapEndedData.score);
	if (newScore==0){
	 return res.status(200).send();
	}
    if (newScore < currentScore || newScore > 13333) {
      return res.status(200).send(); // Ignore if the score is invalid
    }

    const dotwData = {
      mapName: mapEndedData.mapName,
      __class: "DancerOfTheWeek",
      score: newScore,
      profileId: '90b79b61-d934-4b71-8a1c-d6b997b070cda',
      pid: tokenData.ProfileId || "empty",
      gameVersion: skuId.substring(0, 6),
      rank: 1,
      name: consoleChar + profileData.name,
      avatar: profileData.avatar,
      country: profileData.country,
      platformId: '20000',
      alias: profileData.alias,
      aliasGender: profileData.aliasGender,
      jdPoints: profileData.jdPoints,
      portraitBorder: profileData.portraitBorder,
    };

    // Upsert the document in MongoDB (create if not exists, update if it exists)
    await Dotw.findOneAndUpdate({ mapName: mapEndedData.mapName }, dotwData, { upsert: true });

    logger.info(`Profile System: ${profileData.name} is the new Dancer of the Week of ${mapEndedData.mapName} with a score of: ${newScore}`);
    res.status(200).send();

  } catch (error) {
    logger.error(error,`Profile System DOTW Module: Server error:`);
    res.status(500).json({
      status: 500,
      error: 'Internal Server Error'
    });
  }
});

router.get('/profile/v2/country', validator, rateLimitMiddleware, async (req, res) => {
	const ip = req.headers['cf-connecting-ip'] || '127.0.0.0';
	let clientIpCountry = "US";
	try {
		const locationResponse = await fetch(`https://api.iplocation.net/?ip=${ip}`);
		const locationData = await locationResponse.json();

		if (locationData.response_code === "200") {
			clientIpCountry = locationData.country_code2 || "US";
		} else {
			console.warn(`Porfile Country System Ip Error : ${Fixedip}`);
		}
	} catch (error) {
		console.error(`Error fetching IP location: ${error.message}`);
	}

	res.json({
		country: clientIpCountry
	});
});
router.post('/profile/v2/filter-players', validator, rateLimitMiddleware, (req, res) => {
	res.json([]);
});
module.exports = router;