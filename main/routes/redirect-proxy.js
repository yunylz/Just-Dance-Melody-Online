const express = require('express');
const router = express.Router();
const rateLimitMiddleware = require("../ratelimit/rate-limiter");
const { tokenType } = require('./lib/jwtUtils');

const redirectMiddleware = async (req, res) => {
	const authHeader = req.headers.authorization;
	const tokenTypeMid = await tokenType(authHeader);
	let newUrlp;
	if (tokenTypeMid === 'Crack'){
		newUrl = `https://jd-api-backup.azure-api.net/crack${req.originalUrl}`;
	} else {
		newUrl = `http://jd-api-backup.azure-api.net${req.originalUrl}`;
	}
	res.redirect(307, newUrl);
};
const redirectWdfMiddleware = (req, res) => {
	const newUrl1 = `https://jd-api.azure-api.net/jmcs-wdf${req.originalUrl}`;
	res.redirect(307, newUrl1);
};
const redirectWdf1Middleware = (req, res) => {
	const newUrl1 = `https://jdmo-wdf.c0llydoll.com:7010${req.originalUrl}`;
	res.redirect(307, newUrl1);
};
const fs = require('fs');
const logger = require("../logger/logger");
const path = require('path');
const axios = require('axios');
const validator = require("../logger/sessionvalidator");
//redirects
router.post('/profile/v1/filter-players', validator, rateLimitMiddleware, redirectMiddleware);
router.post('/carousel/v2/*', validator, rateLimitMiddleware, redirectMiddleware);
router.get('/session-quest/v1/', validator, rateLimitMiddleware, redirectMiddleware);
router.post('/carousel/v1/*', validator, rateLimitMiddleware, redirectMiddleware);
router.get('/playlistdb/v1/*', validator, rateLimitMiddleware, redirectMiddleware);
router.get('/dance-machine/v1/blocks', validator, rateLimitMiddleware, redirectMiddleware);
router.get('/account/v1/accounts/*', validator, rateLimitMiddleware, redirectMiddleware);

const recommendedFilePath = path.resolve(__dirname, '../data/songdb/recommended.json');

router.get('/recommendation/v1/song-relevance', (req, res) => {
	// Leer el archivo JSON
	fs.readFile(recommendedFilePath, 'utf8', (err, data) => {
		if (err) {
			console.error('Error:', err);
			return res.status(500).json({
				error: 'Error'
			});
		}

		try {
			const recommendedSongs = JSON.parse(data);

			const response = {
				__class: 'RecommendedSongs',
				orderedMaps: recommendedSongs,
			};

			
			res.json(response);
		} catch (parseError) {
			console.error('Error:', parseError);
			res.status(500).json({
				error: 'Error dr'
			});
		}
	});
});
// reco
router.get('/recommendation/v1/*', validator, rateLimitMiddleware, redirectMiddleware);

// 16. WDF 
router.post('/wdf/v1/rooms/MainJDM/*', validator, rateLimitMiddleware, redirectWdfMiddleware);
router.delete('/wdf/v1/rooms/MainJDM/*', validator, rateLimitMiddleware, redirectWdfMiddleware);
router.get('/wdf/v1/rooms/MainJDM/*', validator, rateLimitMiddleware, redirectWdfMiddleware);
router.get('/wdf/v1/server-time', validator, rateLimitMiddleware, redirectWdfMiddleware);
router.post('/sessions/v1/session', validator, rateLimitMiddleware, redirectMiddleware);

module.exports = router;