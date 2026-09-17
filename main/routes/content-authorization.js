const express = require('express');
const fs = require('fs');
const path = require('path');
const rateLimitMiddleware = require("../ratelimit/rate-limiter");
const router = express.Router();
const logger = require("../logger/logger");
const validator = require("../logger/sessionvalidator");
const validators2s = require("../logger/sessionvalidator-s2s");
const redis = require('redis');
const {
	createClient
} = require('@redis/client');

const redisUrl = 'redis://127.0.0.1:6379';

const client = createClient({
	url: redisUrl
});

client.on('error', (err) => {
	logger.error(err, 'Content Auth Module: Redis client error:');
});

client.connect().then(() => {
	logger.info('Content Auth Module: Redis client connected');
}).catch(err => {
	logger.error(err, 'Failed to connect to Redis:');
});

router.get('/content-authorization/v1/maps/:mapName', validators2s, rateLimitMiddleware, async (req, res) => {
	const mapName = req.params.mapName;
	const authorization = req.headers['authorization'] || "fake";
	const s2sToken = req.headers['x-api-key'];
	const token = authorization.substring(7, 257);
	const tokenKey = `validatedTokens:${token}`;
	const tokenData = await client.get(tokenKey);
	
	const devFilePath = path.resolve(__dirname, `../data/maps/Dev/${mapName}.json`);
	const exclusiveFilePath = path.resolve(__dirname, `../data/maps/Exclusive/${mapName}.json`);
	const normalFilePath = path.resolve(__dirname, `../data/maps/${mapName}.json`);

	if (tokenData || s2sToken) {
		let validatedJson;
		if (tokenData){
		validatedJson = JSON.parse(tokenData);
		} else {
			validatedJson = {
				Environment: "Prod"
			}
		}	
		if (validatedJson.Environment === "Developer") {

			// Verificar devFilePath primero
			fs.access(devFilePath, fs.constants.F_OK, (err) => {
				if (err) {

					// Si no existe, verificar exclusiveFilePath
					fs.access(exclusiveFilePath, fs.constants.F_OK, (err) => {
						if (err) {

							// Si tampoco existe, verificar normalFilePath
							fs.access(normalFilePath, fs.constants.F_OK, (err) => {
								if (err) {
									logger.warn(`Content Auth Module Error: Dev content not found for: ${mapName}`);
									return res.status(403).json({
										status: 403,
										error: 'Forbidden'
									});
								}

								// Enviar el archivo normal si existe
								res.sendFile(normalFilePath);
							});

						} else {
							// Enviar el archivo exclusive si existe
							res.sendFile(exclusiveFilePath);
						}
					});

				} else {
					// Enviar el archivo dev si existe
					res.sendFile(devFilePath);
				}
			});
		} else if (validatedJson.Environment === "Patreon") {
			fs.access(exclusiveFilePath, fs.constants.F_OK, (err) => {
				if (err) {

					
					fs.access(normalFilePath, fs.constants.F_OK, (err) => {
						if (err) {
							logger.warn(`Content Auth Module Error: Patreon content not found for: ${mapName}`);
							return res.status(403).json({
								status: 403,
								error: 'Forbidden'
							});
						}

												
						res.sendFile(normalFilePath);
					});

				} else {
					
					res.sendFile(exclusiveFilePath);
				}
			});
		} else {
			// If token is not validated, check the normal file
			fs.access(normalFilePath, fs.constants.F_OK, (err) => {
				if (err) {
					logger.warn(`Content Auth Module Error: Public Content not found for: ${mapName}`);
					return res.status(403).json({
						status: 403,
						error: 'Forbidden'
					});
				}

				// If the normal file exists, send it
				res.sendFile(normalFilePath);
			});
		}
	} else {
		return res.status(403).json({
			status: 403,
			error: 'Forbidden'
		});
	}
});

module.exports = router;
