const jwt = require('jsonwebtoken');
const redis = require('redis');
const {
	createClient
} = require('@redis/client');

const redisUrl = 'redis://127.0.0.1:6379'; 

const client = createClient({
	url: redisUrl
});

client.on('error', (err) => {
	console.log(err,'JWT Module: Redis client error:');
});

client.connect().then(() => {
	console.log('JWT Module Redis client connected');
}).catch(err => {
	console.log(err,'Failed to connect to Redis:');
});
const generateToken = (payload) => {
  const secretKey = process.env.JWTSecret; 
  const options = {
    expiresIn: '3h', 
  };
  const token = jwt.sign(payload, secretKey, options);
  return token;
};

const tokenType = async (header) => {
 const tokenJMCS = header.substring(7, 257);
 const tokenKey = `validatedTokens:${tokenJMCS}`;
 const tokenData = await client.get(tokenKey);
 const tokenInfo = JSON.parse(tokenData);
 return tokenInfo.Environment
};

module.exports = {
  generateToken,
  tokenType
};