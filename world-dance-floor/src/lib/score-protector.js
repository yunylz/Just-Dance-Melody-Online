// External modules
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

var platforms = ["x1", "ps4", "pc", "nx", "wiiu"];
var keys = {};

const init = async (options) => {
    var hashes = crypto.getHashes();
    if (hashes.indexOf("RSA-SHA256") === -1)
        throw new Error("Hash algorithm RSA-SHA256 is not available");

    var ciphers = crypto.getCiphers();
    if (ciphers.indexOf("aes-128-cbc") === -1)
	    throw new Error("Cipher algorithm aes-128-cbc is not available");
    
    platforms.forEach(function(platform) {
		keys[platform] = {
			rsa: {
				privateKey: fs.readFileSync(path.join(global.root, "data/score-protector-keys/" + platform + "/private.pem"), "utf8"),
				publicKey: fs.readFileSync(path.join(global.root, "data/score-protector-keys/" + platform + "/public.pem"), "utf8")
			}
		}
	});

    keys.default = {
		rsa: keys.pc.rsa
	};

    return;
};

const encryptScoreAESAndRSA = (score, platform) => {
    var aesKey = crypto.randomBytes(16)
    var aesIV = crypto.randomBytes(16)

    var aes = crypto.createCipheriv("aes-128-cbc", aesKey, aesIV);
    var encryptedScore = aes.update(score, "utf8", "base64");
    encryptedScore += aes.final("base64");

    var publicKey = keys[platform] ? keys[platform].rsa.publicKey : keys.default.rsa.publicKey;

    var encryptedAESKey = crypto.publicEncrypt(publicKey, aesKey).toString("base64");
    var encryptedAESIV = crypto.publicEncrypt(publicKey, aesIV).toString("base64");

    return encryptedScore + "." + encryptedAESKey + "." + encryptedAESIV;
};

const decryptScoreAESAndRSA = (encryptedScore, platform) => {
    var parts = encryptedScore.split(".")
	if (parts.length !== 3) return null;

	var privateKey = keys[platform] ? keys[platform].rsa.privateKey : keys.default.rsa.privateKey

	var aesKey = crypto.privateDecrypt(privateKey, Buffer.from(parts[1], "base64"))
	var aesIV = crypto.privateDecrypt(privateKey, Buffer.from(parts[2], "base64"))

	var aes = crypto.createDecipheriv("aes-128-cbc", aesKey, aesIV)
	var decryptedScore = aes.update(parts[0], "base64", "utf8")
	decryptedScore += aes.final("utf8")

	return decryptedScore;
};

const signScore = (score, platform) => {
    var signObj = crypto.createSign("RSA-SHA256");
	signObj.update(score);
	var privateKey = keys[platform] ? keys[platform].rsa.privateKey : keys.default.rsa.privateKey
	return signObj.sign(privateKey, "base64");
};

var operationsPerScoreType = {
	"int": {
		encrypt: function(score, platform) {
			return encryptScoreAESAndRSA(score.toFixed(0), platform)
		},
		decrypt: function(req, decryptionParams, next) {
			var encryptedScore = req.body[decryptionParams.encryptedScoreField]
			var platform = req.sku.platform
			var score = parseInt(decryptScoreAESAndRSA(encryptedScore, platform))

			if (isNaN(score))
				return next(new Error("float score decryption failed"))

			req.body[decryptionParams.scoreField] = score
			return next()
		},
		sign: function(score, platform) {
			return signScore(score.toFixed(0), platform)
		}
	},

	"float": {
		encrypt: function(score, platform) {
			return encryptScoreAESAndRSA(score.toFixed(6), platform)
		},
		decrypt: function(req, decryptionParams, next) {
			var encryptedScore = req.body[decryptionParams.encryptedScoreField]
			var platform = req.sku.platform
			var score = parseFloat(decryptScoreAESAndRSA(encryptedScore, platform))
			if (isNaN(score))
				return next(new Error("float score decryption failed"))

			req.body[decryptionParams.scoreField] = score
			return next()
		},
		sign: function(score, platform) {
			return signScore(score.toFixed(6), platform)
		}
	},
	"floatWithTimestamp": {
		encrypt: function(score, platform) {
			return encryptScoreAESAndRSA(score.toFixed(6) + ":" + time.secondsDouble(), platform)
		},
		decrypt: function(req, decryptionParams, next) {
				var encryptedScore = req.body[decryptionParams.encryptedScoreField]
				var platform = req.sku.platform
				var decryptedScore = decryptScoreAESAndRSA(encryptedScore, platform)
				
				var score = NaN, timestamp = NaN // eslint-disable-line no-unused-vars

				var parts = decryptedScore.split(":")
				if (parts.length === 2) {
					score = parseFloat(parts[0])
					timestamp = parseFloat(parts[1])
				}

				if (isNaN(score))
					return next(new Error("floatWithTimestamp score decryption failed"))

				req.body[decryptionParams.scoreField] = score
				return next()
			},
		sign: function(score, platform) {
			return signScore(score.toFixed(6), platform)
		}
	}
};

const decrypt = (encryptedScoreField, scoreField, scoreType) => {
    if (!operationsPerScoreType[scoreType]) {
        throw new Error("Invalid score type for decryption: " + scoreType)
    }
    
    return function (req, res, next) {
        if (!req.sku) return next(new Error("sku info missing"));

		if (!req.body.hasOwnProperty(scoreField) || !req.body.hasOwnProperty(encryptedScoreField))
			return res.sendStatus(400)

		return operationsPerScoreType[scoreType].decrypt(req, {
			encryptedScoreField: encryptedScoreField,
			scoreField: scoreField
		}, next)
    }
};

const encrypt = (score, scoreType, platform) => {
    if (!operationsPerScoreType[scoreType]) {
        throw new Error("Invalid score type for encryption: " + scoreType)
    }

    return operationsPerScoreType[scoreType].encrypt(score, platform)
};

const sign = (score, scoreType, platform) => {
    if (!operationsPerScoreType[scoreType]) {
        throw new Error("Invalid score type for signing: " + scoreType)
    }

    return operationsPerScoreType[scoreType].sign(score, platform)
};

module.exports = {
    init,
    decrypt,
    encrypt,
    sign
};