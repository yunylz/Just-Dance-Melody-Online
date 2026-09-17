const express = require('express');
const axios = require('axios');
const fs = require('fs');
const http = require('http');
const router = express.Router();
const path = require('path');
const validator = require("../logger/sessionvalidator");
const rateLimitMiddleware = require("../ratelimit/rate-limiter");
const rateLimitMiddlewareSessions = require("../ratelimit/rate-limiter-sessions");
const logger = require("../logger/logger");

const {
	createClient
} = require('@redis/client');

const redisUrl = 'redis://127.0.0.1:6379'; 
const client = createClient({
	url: redisUrl
});

client.connect().then(() => {
	logger.info('WDF Redis client connected');
}).catch(err => {
	logger.error(err,'Failed to connect to Redis:');
});

const redirectToWdfServer = async (req, res, next) => {
	if (req.path.startsWith("/wdf/")) {
		try {
			const partialToken = req.headers["authorization"].substring(7, 257);
			const tokenKey = `validatedTokens:${partialToken}`;
			const tokenData = await client.get(tokenKey);

			var tokenJSON = JSON.parse(tokenData);
			var isDev = tokenJSON.Environment === "Developer" ? true : false;
			var isPatreon = tokenJSON.Environment === "Patreon" ? true : false;
			var isProd = tokenJSON.Environment === "Production" ? true : false;

			if (isProd || isDev || isPatreon) {
				const proxyUrl = `http://localhost:5441${req.originalUrl}`;
				
				// Clone headers and remove problematic ones
				const headers = { ...req.headers };
				delete headers['content-length'];
				delete headers['host'];
				
				// Prepare body for non-GET/HEAD requests
				let bodyStr = undefined;
				if (req.method !== 'GET' && req.method !== 'HEAD') {
					if (req.body) {
						if (typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
							// JSON body
							bodyStr = JSON.stringify(req.body);
							headers['content-type'] = 'application/json';
						} else if (typeof req.body === 'string' || Buffer.isBuffer(req.body)) {
							bodyStr = req.body;
						}
						if (bodyStr) {
							headers['content-length'] = Buffer.byteLength(bodyStr);
						}
					}
				}
				
				const proxyReq = http.request(proxyUrl, {
					method: req.method,
					headers,
					timeout: 10000 // 10 second timeout
				}, proxyRes => {
					res.status(proxyRes.statusCode);
					Object.entries(proxyRes.headers).forEach(([key, value]) => {
						if (value !== undefined) res.setHeader(key, value);
					});
					proxyRes.pipe(res);
				});
				
				proxyReq.on('timeout', () => {
					logger.error('Proxy request timed out');
					proxyReq.destroy();
					if (!res.headersSent) res.status(504).send('Gateway Timeout');
				});
				
				proxyReq.on('error', err => {
					logger.error(err, 'Proxy to local WDF server failed:');
					if (!res.headersSent) res.status(502).send('Bad Gateway');
				});
				
				// Write body if present
				if (bodyStr !== undefined) {
					proxyReq.write(bodyStr);
				}
				proxyReq.end();
				return;
			} else {
				return next();
			}
		} catch (error) {
			logger.error(error, 'WDF Redirect to Local Server Error:');
			return next();
		}
	} else {
		next();
	}
};

router.use(redirectToWdfServer);

const wdfRoomMiddleware = async (req, res, next) => {
	try {
		const gameHeader = req.headers['x-skuid'];	
		if (gameHeader.includes('jd2021') || gameHeader.includes('jd2022')) {
			return res.json({
				"__class": "RoomInfo",
				"room": "MainJDM",
				"type": "hard",
				"start": null,
				"end": null
			});
		} else {	
			return res.json({
				room: "MainJDM"
			});
		}
		next();
	} catch (error) {
		logger.error(error, 'Wdf Assign Room Module Error:');
		res.status(500).json({
			status: 500,
			error: 'Internal Server Error'
		});
	}
};

const redirectMiddleware = (req, res) => {
	const newUrl = `https://jd-api-backup.azure-api.net${req.originalUrl}`;
	res.redirect(307, newUrl);
};

router.get('/wdf/v1/server-time', rateLimitMiddleware, validator, (req, res) => {
	const currentTime = Date.now() / 1000;
	res.json({
		time: currentTime
	});
});

router.get('/wdf/v1/online-bosses', rateLimitMiddleware, validator, (req, res) => {
	res.json({
		"__class": "OnlineBossDb",
		"bosses": {}
	});
});

router.get('/wdf/v1/rooms/MainJDM/newsfeed', rateLimitMiddleware, validator, (req, res) => {
	res.json({
		"__class": "NewsfeedList",
		"entries": []
	});
});

router.get('/wdf/v1/rooms/MainJDM/next-happyhours', rateLimitMiddleware, validator, (req, res) => {
	const currentTime = Date.now() / 1000;
	res.json({
		"__class": "HappyHoursInfo",
		"start": currentTime,
		"end": currentTime + 14400,
		"running": true
	});
});

router.get('/wdf/v1/rooms/MainJDM/online-rank-widget', rateLimitMiddleware, validator, async (req, res) => {
	try {
		const headers = new Headers(req.headers);
		headers.set('wdf-key-azure', 'iVC03NEB6D09OSn2acbU3dTNOmawzKsv'); // Add or overwrite the custom header

		// Make the request to the external service
		const response = await fetch('http://127.0.0.1:777/wdf/v1/rooms/MainJDM/online-rank-widget', {
			method: 'GET',
			headers: headers
		});

		// Get the response data
		const data = await response.text();

		// Send the response data and status code from the external service to the client
		res.status(response.status).json(JSON.parse(data));
	} catch (error) {
		logger.error(`WDF System: Error retrieving Online rank widget: ${error.message}`);
		res.status(500).send('Internal Server Error');
	}
});

router.post('/wdf/v1/rooms/MainJDM/screens', rateLimitMiddleware, validator, async (req, res) => {
	try {
		const headers = new Headers(req.headers);
		headers.set('wdf-key-azure', 'iVC03NEB6D09OSn2acbU3dTNOmawzKsv'); // Add or overwrite the custom header

		// Make the request to the external service
		const response = await fetch('http://127.0.0.1:777/wdf/v1/rooms/MainJDM/screens', {
			method: 'POST',
			headers: headers
		});

		// Get the response data
		const data = await response.text();

		// Send the response data and status code from the external service to the client
		res.status(response.status).json(JSON.parse(data));
	} catch (error) {
		logger.error(`WDF System: Error retrieving Screen: ${error.message}`);
		res.status(500).send('Internal Server Error');
	}
});

router.get('/wdf/v1/rooms/MainJDM/session-recap', rateLimitMiddleware, validator, async (req, res) => {
	try {
		const headers = new Headers(req.headers);
		headers.set('wdf-key-azure', 'iVC03NEB6D09OSn2acbU3dTNOmawzKsv'); // Add or overwrite the custom header

		// Make the request to the external service
		const response = await fetch('http://127.0.0.1:777/wdf/v1/rooms/MainJDM/session-recap', {
			method: 'GET',
			headers: headers
		});

		// Get the response data
		const data = await response.text();

		// Send the response data and status code from the external service to the client
		res.status(response.status).json(JSON.parse(data));
	} catch (error) {
		logger.error(`WDF System: Error retrieving Session Recap: ${error.message}`);
		res.status(500).send('Internal Server Error');
	}
});

router.get('/wdf/v1/rooms/MainJDM/ccu', rateLimitMiddleware, validator, async (req, res) => {
	try {
		const headers = new Headers(req.headers);
		headers.set('wdf-key-azure', 'iVC03NEB6D09OSn2acbU3dTNOmawzKsv'); // Add or overwrite the custom header

		// Make the request to the external service
		const response = await fetch('http://127.0.0.1:777/wdf/v1/rooms/MainJDM/ccu', {
			method: 'GET',
			headers: headers
		});

		// Get the response data
		const data = await response.text();

		// Send the response data and status code from the external service to the client
		res.status(response.status).send(data);
	} catch (error) {
		logger.error(`WDF System: Error retrieving CCU: ${error.message}`);
		res.status(500).send('Internal Server Error');
	}
});

router.post('/wdf/v1/assign-room',validator, rateLimitMiddlewareSessions, wdfRoomMiddleware);

module.exports = router;