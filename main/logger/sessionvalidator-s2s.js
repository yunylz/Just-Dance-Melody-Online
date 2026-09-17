const redis = require('redis');
const logger = require('./logger');
const {
	createClient
} = require('@redis/client');

const redisUrl = 'redis://127.0.0.1:6379'; 
const client = createClient({
	url: redisUrl
});

client.on('error', (err) => {
	logger.error(err,'Token Validator Module: Redis client error:');
});

client.connect().then(() => {
	logger.info('Token Validator Module Redis client connected');
}).catch(err => {
	logger.error(err,'Failed to connect to Redis:');
});

// S2S API key for bypassing Redis validation
const S2S_API_KEY = process.env.s2sApiKey;
const S2S_API_KEY_YUNYL = "Basic pussymagicyunyls2skeyyasssss-nojd27foru";

const validarSesion = async (req, res, next) => {
    try {
        // Check for S2S API key first
        const apiKey = req.headers['x-api-key'];
        if (apiKey && apiKey === S2S_API_KEY_YUNYL) {
            logger.info('S2S request detected, bypassing Redis validation');
            req.sessionInfo = {
                isS2S: true,
                isBanned: false,
                Environment: "Prod" // force this, we dont want him on dev
            };
            return next();
        }

        if (apiKey && apiKey === S2S_API_KEY) {
            logger.info('S2S request detected, bypassing Redis validation');
            req.sessionInfo = {
                isS2S: true,
                isBanned: false
            };
            return next();
        }

        // Continue with regular token validation
        const tokenJMCS = req.headers['authorization']; 
		if (!tokenJMCS) {
            return res.status(401).json({ status: 401, error: 'Unauthorized' });
        }
		
        const token = tokenJMCS.substring(7, 257);
        if (!token) {
            return res.status(401).json({ status: 401, error: 'Unauthorized' });
        }
        
        const tokenKey = `validatedTokens:${token}`;
        
        const tokenData = await client.get(tokenKey);
        if (!tokenData) {
            return res.status(401).json({ status: 401, error: 'Unauthorized' });
        }
        
        const sessionInfo = JSON.parse(tokenData);
        if (sessionInfo.isBanned) {
            return res.status(403).json({ status: 403, error: 'Forbidden' });
        }
        
        req.sessionInfo = sessionInfo; 
        next();
    } catch (error) {
        console.error(error,'Token Validator Error:');
        res.status(500).json({ status: 500, error: 'Internal Server Error' });
    }
};

module.exports = validarSesion;