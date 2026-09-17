const express = require('express');
const path = require('path');
const router = express.Router();
const validator = require("../logger/sessionvalidator");
const validators2s = require("../logger/sessionvalidator-s2s"); // using s2s for the utils api to grab itemdb stuff
const rateLimitMiddleware = require("../ratelimit/rate-limiter");
const logger = require("../logger/logger");
const fs = require('fs');

router.get('/customizable-itemdb/v1/items', validators2s, rateLimitMiddleware, (req, res) => {
    try {
        const skuid = req.headers['x-skuid'] ? req.headers['x-skuid'].toLowerCase() : '';

        let fileToSend;
		if (skuid.startsWith('jd2019')) {
            fileToSend = 'items_jd19.json';
        }
        else if (skuid.startsWith('jd2020')) {
            fileToSend = 'items_jd20.json';
        } else if (skuid.startsWith('jd2021')) {
            fileToSend = 'items_jd21.json';
        } else if (skuid.startsWith('jd2022')) {
            fileToSend = 'items_jd22.json';
        } else if (skuid === 'jdmelody-pc-all') {
            fileToSend = 'items_pc.json';
        } else {
            fileToSend = 'items.json';
        }

        const filePath = path.resolve(__dirname, '..', 'data', 'itemdb', fileToSend);

        res.sendFile(filePath);
    } catch (err) {
        logger.error(err, 'ItemDB Module Error:');
        return res.status(500).json({
            status: 500,
            error: 'Internal Server Error'
        });
    }

});
router.get('/avatardb/v1/avatars', validators2s, rateLimitMiddleware, (req, res) => {
	const filePath = path.join(__dirname, '../data/itemdb/avatars.json');

	fs.readFile(filePath, 'utf8', (err, data) => {
		if (err) {
			logger.error(err,'Itemdb System Error: Error reading current avatars file. check Error: ');
			return res.status(500).json({
				status: 500,
				error: 'Internal Server Error'
			});
		}

		try {
			const jsonData = JSON.parse(data);
			res.status(200).json(jsonData);
		} catch (parseError) {
			logger.error(parseError,'Carousel System Error: Error parsing current avatars file. check Error: ');
			return res.status(500).json({
				status: 500,
				error: 'Internal Server Error'
			});
		}
	});
});

router.get('/aliasdb/v1/aliases', validators2s, rateLimitMiddleware, (req, res) => {
    try {
        const skuid = req.headers['x-skuid'] ? req.headers['x-skuid'].toLowerCase() : '';

        let fileToSend;
        if (skuid.startsWith('jd2020')) {
            fileToSend = 'aliases_jd20.json';
        } else if (skuid.startsWith('jd2021')) {
            fileToSend = 'aliases_jd20.json';
        } else if (skuid.startsWith('jd2022')) {
            fileToSend = 'aliases_jd20.json';
        } else if (skuid.startsWith('jd2019')) {
            fileToSend = 'aliases_jd19.json';
        }
		else if (skuid === 'jdmelody-pc-all') {
            fileToSend = 'aliases_jd19.json';
        } else {
            fileToSend = 'aliases_jd19.json';
        }

        const filePath = path.resolve(__dirname, '..', 'data', 'aliasdb', fileToSend);

        const aliasdb = require(filePath);

        // Load custom aliases
        const customAliasesPath = path.resolve(__dirname, '..', 'data', 'aliasdb', 'custom_aliases.json');

        const customAliases = JSON.parse(fs.readFileSync(customAliasesPath, 'utf8'));

        // Form custom aliases
        customAliases.forEach(alias => {
            // Add custom alias to aliasdb
            aliasdb.aliases[alias.id.toString()] = {
                "__class": "JD_UnlockableAliasDescriptor",
                "DifficultyColor": alias.color,
                "RestrictedToUnlimitedSongs": 0,
                "StringLocID": 4294967295,
                "StringLocIDFemale": 4294967295,
                "StringPlaceholder": alias.maleString,
                "StringOnlineLocalized": alias.maleString,
                "StringOnlineLocalizedFemale": alias.femaleString,
                "DescriptionLocalized": alias.description,
                "Visibility": alias.visibility
            };
        });

        res.send(aliasdb);
    } catch (err) {
        logger.error(err, 'AliasDB Module Error:');
        res.status(500).json({
            status: 500,
            error: 'Internal Server Error'
        });
    }

});


module.exports = router;