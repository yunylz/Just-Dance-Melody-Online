// External modules
const express = require("express");
const winston = require("winston");

// Internal modules
const cache = require("./cache");
const redis = require("./redis").client;
const oasis = require("./oasis");


/**
 * @param {express.Application} app
 * @param {winston.Logger} logger
 */
const init = (app, logger) => {
    // Settings
    app.set("etag", false); // disable etag header
    app.set("x-powered-by", false); // disable x-powered-by header

    // Body parsing and validation
    app.use(express.json());

    // WDF middlewares
    app.use(appendLanguage);
    app.use(appendSku);
    app.use(appendToken);
    app.use(appendProfile);
    app.use(appendRoom);
};

/**
 * Append sku to the request
 * @param {express.Request} req 
 * @param {express.Response} res 
 * @param {express.NextFunction} next
 */
const appendSku = (req, res, next) => {
    const clientSku = req.headers["x-skuid"];

    const { skus } = cache.file("/data/skus.json");

    const sku = skus.find(s => s.skuId === clientSku);

    if (!sku) {
        // TODO: handle error properly and log it
        return res.status(403).send({
            "error": "sku not authorized for WDF"
        });
    }

    req.sku = sku;

    next();
};

/**
 * Append token to the request
 * @param {express.Request} req 
 * @param {express.Response} res 
 * @param {express.NextFunction} next
 */
const appendToken = (req, res, next) => {
    const authorizationHeader = req.headers["authorization"];

    const tokenHeader = authorizationHeader.split(" ");

    switch (tokenHeader[0]) {
        case "Ubi_v1":
            req.authorization = {
                type: "ubi",
                token: tokenHeader[1],
                raw: authorizationHeader
            };
            break;
        default:
            // TODO: handle error properly and log it
            return res.status(401).send({
                "error": "invalid authorization header"
            });
    }

    next();
};

/**
 * TODO: update this function when profiles system is improved
 * Append profile data to the request
 * @param {express.Request} req 
 * @param {express.Response} res 
 * @param {express.NextFunction} next
 */
const appendProfile = (req, res, next) => {
    (async () => {
        const partialToken = req.headers["authorization"].substring(7, 257);

        const profileKey = `userProfileData:${partialToken}`;
        const profileData = await redis.get(profileKey);

        const tokenKey = `validatedTokens:${partialToken}`;
        const tokenData = await redis.get(tokenKey);

        if (!profileData || !tokenData) {
            // TODO: handle error properly and log it
            return res.status(401).send({
                "error": "invalid token or profile data",
                "profile": profileData,
                "token": tokenData
            });
        }

        req.profile = JSON.parse(profileData);
        req.tokenData = JSON.parse(tokenData);
        
        next();
    })();
};

/**
 * Append room data to the request
 * @param {express.Request} req 
 * @param {express.Response} res 
 * @param {express.NextFunction} next 
 */
const appendRoom = (req, res, next) => {
    const { rooms } = cache.file("/data/rooms.json");

    // find room by sku gameVersion
    const room = rooms.find(r => r.skus.includes(req.sku.id));

    // TODO: check for crack later

    req.room = room;

    next();
};

/**
 * Append language data to the request
 * @param {express.Request} req 
 * @param {express.Response} res 
 * @param {express.NextFunction} next 
 * @returns 
 */
const appendLanguage = (req, res, next) => {
    if (req.language) return next();

    req.language = oasis.defaultLanguage;
    req.languageIndex = oasis.defaultLanguageIndex;

    var acceptLanguages = req.headers["accept-language"];
    if (acceptLanguages) {
        acceptLanguages.toLowerCase().split(",").some(function(language) {
            language = oasis.getBaseLanguage(language.trim());

            var index = language.indexOf(";");
            if (index !== -1) {
                language = language.substring(0, index);
            }

            var languageIndex = oasis.languages.indexOf(language);
            if (languageIndex !== -1) {
                req.language = language;
                req.languageIndex = languageIndex;
                return true;
            }
        });
    }

    next();
};


module.exports = {
    init
};