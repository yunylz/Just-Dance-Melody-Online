const express = require('express');
const router = express.Router();
const path = require('path');
const logger = require("../logger/logger");
const validators2s = require("../logger/sessionvalidator-s2s");
const validator = require("../logger/sessionvalidator");
const fs = require('fs');
const rateLimitMiddleware = require("../ratelimit/rate-limiter");

const redis = require('redis');
const {
	createClient
} = require('@redis/client');

const redisUrl = 'redis://127.0.0.1:6379';

const client = createClient({
	url: redisUrl
});

client.on('error', (err) => {
	logger.error(err, 'Songdb Module: Redis client error:');
});

client.connect().then(() => {
	logger.info('Songdb Module: Redis client connected');
}).catch(err => {
	logger.error(err, 'Failed to connect to Redis:');
});
const getSongDbPath = (version, skuId, environment) => {
  const platforms = {
    v2: {
      ps4: 'PS4',
      nx: 'NX',
      pc: 'PC'
    },
    v1: {
      'jdmelody-pc': 'jdmelody-pc',
      'jd2018-pc': 'jdmelody-pc',
      'jd2018-nx': 'jdmelody-nx',
      'jd2017-nx': 'jdmelody-nx',
      'jd2018-ps4': 'jdmelody-ps4',
      'jd2017-ps4': 'jdmelody-ps4',
      'jd2016-ps4': 'jdmelody-ps4'
    }
  };

  const getPlatform = (id) => {
    if (version === 'v2') {
      return Object.entries(platforms.v2).find(([key]) => id.includes(key))?.[1];
    }
    return Object.entries(platforms.v1).find(([key]) => id.includes(key))?.[1];
  };

  const platform = getPlatform(skuId);
  if (!platform) return null;

  const envSuffix = version === 'v2' 
    ? environment === 'Patreon' ? '_Patreon' : environment === 'Developer' ? '_Dev' : ''
    : environment === 'Patreon' ? '-patreon' : environment === 'Developer' ? '-dev' : '-all';

  return version === 'v2'
    ? path.resolve(__dirname, `../data/songdb/${platform}/SongDB${envSuffix}.json`)
    : path.resolve(__dirname, `../data/songdb/${platform}${envSuffix}.json`);
};

const handleSongDbRequest = async (req, res, version) => {
  const { headers: { 'x-skuid': skuId, authorization,'x-api-key': s2sToken } } = req;
  
  try {
    let token;
	if (authorization){
		token = authorization.substring(7, 257);
	} else {
		token = "test";
	}
    const tokenKey = `validatedTokens:${token}`;
    const tokenData = await client.get(tokenKey);
    if (!tokenData && !s2sToken) {
      return res.status(401).json({ status: 401, error: 'Unauthorized' });
    }
	let skuIds2s;
	if (s2sToken)
	{
		skuIds2s="jd2018-nx-all";
	}
	else {
		skuIds2s="na";
	}
    const { Environment } = JSON.parse(tokenData) || "Prod";
    const filePath = getSongDbPath(version, skuId || skuIds2s, Environment);

    if (!filePath) {
      return res.status(404).json({ status: 404, error: 'Not Found' });
    }

    res.setTimeout(30000); 
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Keep-Alive', 'timeout=30');

    await new Promise((resolve, reject) => {
      res.sendFile(filePath, (err) => {
        if (err) {
          logger.error(err, `SongDatabase ${version.toUpperCase()} System: Error sending songdb: ${filePath}`);
          reject(err);
        } else {
          resolve();
        }
      });
    });
  } catch (error) {
    logger.error(error, `SongDB ${version.toUpperCase()} Module Error:`);
    return res.status(500).json({ status: 500, error: 'Internal Server Error' });
  }
};


router.get('/songdb/v2/songs', validators2s, rateLimitMiddleware, (req, res) => 
  handleSongDbRequest(req, res, 'v2')
);

router.get('/songdb/v1/songs', validators2s, rateLimitMiddleware, (req, res) => 
  handleSongDbRequest(req, res, 'v1')
);

router.get('/packages/v1/sku-packages', validator, rateLimitMiddleware, async (req, res) => {
	const skuId = req.headers['x-skuid'];
	const authorization = req.headers['authorization'];

	const token = authorization.substring(7, 257);
	let filePath;
	try {
		const tokenKey = `validatedTokens:${token}`;
		const tokenData = await client.get(tokenKey);

		if (tokenData) {
			const validatedJson = JSON.parse(tokenData);


			if (validatedJson.Environment === "Developer") {
				if (skuId.includes('ps4')) {
					filePath = path.resolve(__dirname, '../data/packages/PS4/sku-packages-dev.json');
				} else if (skuId.includes('nx')) {
					filePath = path.resolve(__dirname, '../data/packages/NX/sku-packages-dev.json');
				} else if (skuId.includes('pc')) {
					filePath = path.resolve(__dirname, '../data/packages/PC/sku-packages-dev.json');
				} else {
					return res.status(404).json({
						error: 'Not Found'
					});
				}
			} else {

				if (skuId.includes('ps4')) {
					filePath = path.resolve(__dirname, '../data/packages/PS4/sku-packages.json');
				} else if (skuId.includes('nx')) {
					filePath = path.resolve(__dirname, '../data/packages/NX/sku-packages.json');
				} else if (skuId.includes('pc')) {
					filePath = path.resolve(__dirname, '../data/packages/PC/sku-packages.json');
				} else {
					return res.status(404).json({
						error: 'Not Found'
					});
				}
			}
		} else {
			if (skuId.includes('ps4')) {
				filePath = path.resolve(__dirname, '../data/packages/PS4/sku-packages.json');
			} else if (skuId.includes('nx')) {
				filePath = path.resolve(__dirname, '../data/packages/NX/sku-packages.json');
			} else if (skuId.includes('pc')) {
				filePath = path.resolve(__dirname, '../data/packages/PC/sku-packages.json');
			} else {
				return res.status(404).json({
					error: 'Not Found'
				});
			}
		}

		res.sendFile(filePath, (err) => {
			if (err) {
				logger.error(err,`SkuPackages V1 System: Error sending skupackages: ${filePath}`);
				res.status(500).json({
					status: 500,
					error: 'Internal Server Error'
				});
			}
		});
	} catch (error) {
		logger.error(`Redis Error: ${error.message}`);
		return res.status(500).json({
			status: 500,
			error: 'Internal Server Error'
		});
	}

});

router.get('/com-video/v1/com-videos-fullscreen', validator,rateLimitMiddleware, (req, res) => {
	return res.status(200).json({});
});

module.exports = router;