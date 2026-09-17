const axios = require("axios");
const express = require("express");
const sharp = require("sharp");

const router = express.Router();

var countries = require("../data/countries.json");
var flagRectangle = {
    left: 40,
    top: 195,
    width: 151,
    height: 75
};

// functions
const fetchImage = async (url) => {
    try {
        const response = await axios.get(url, { 
            responseType: 'arraybuffer',
            headers: { "user-agent": "UbiServices_SDK_2019.Release.11_SWITCH64" } 
        });
        return response.data;
    } catch (error) {
        throw new Error("Error fetching image: " + error.message);
    }
};

const validateImageBuffer = async (buffer) => {
    try {
        await sharp(buffer).metadata();
        return true;
    } catch (error) {
        console.error("Invalid image buffer:", error.message);
        return false;
    }
};

router.get("/composeFullAvatar",
    async (req, res) => {
        var version = req.query.version;
        var itemsInOrder = [];
        var itemLinksInOrder = [];

        switch (version) {
            case "jd2017":
            case "jd2018":
                itemsInOrder = [ "country", "skin", "avatar" ];
                break;
            case "jd2019":
                itemsInOrder = [ "avatar" ];
                break;
            default:
                itemsInOrder = [ "portraitBorder-back", "avatar", "portraitBorder-front" ];
        }

        // get the links for each item
        for (var i = 0; i < itemsInOrder.length; i++) {
            var item = itemsInOrder[i];

            switch (item) {
                case "country":
                    if (req.query.country) {
                        var countryId = req.query.country.toString();
                        if (countries[countryId]) {
                            itemLinksInOrder[i] = `https://jdmo-cdn.c0llydoll.com/public/dashboard/flags/old/${countries[countryId].flag}.png`
                        }
                    }
                    break;
                case "skin":
                    if (req.query.skin) {
                        var skinId = req.query.skin.toString();
                        itemLinksInOrder[i] = global.itemDb.skins[skinId].url;
                    }
                    break;
                case "avatar":
                    if (req.query.avatar) {
                        var avatarId = req.query.avatar.toString();
                        itemLinksInOrder[i] = global.itemDb.avatars[avatarId].url;
                    }
                    break;
                case "portraitBorder-back":
                    if (req.query.portraitBorder) {
                        var portraitBorderId = req.query.portraitBorder.toString();
                        itemLinksInOrder[i] = global.itemDb.portraitBorders[portraitBorderId].backgroundUrl;
                    }
                    break;
                case "portraitBorder-front":
                    if (req.query.portraitBorder) {
                        var portraitBorderId = req.query.portraitBorder.toString();
                        itemLinksInOrder[i] = global.itemDb.portraitBorders[portraitBorderId].foregroundUrl;
                    }
                    break;
            }
        }

        // filter out undefined links
        const validLinks = itemLinksInOrder.filter(link => link !== undefined);

        // fetch the images
        try {
            const images = await Promise.all(
                validLinks.map(url => fetchImage(url))
            );

            // validate images
            for (let i = 0; i < images.length; i++) {
                if (!await validateImageBuffer(images[i])) {
                    throw new Error(`Invalid image at index ${i}, URL: ${itemLinksInOrder[i]}`);
                }
            }
            
            // if country flag, we're gonna place it in an empty canvas resized correctly, and in the x-y axis defined
            if (itemsInOrder.includes("country")) {
                // canvas is 512x, create it
                // and only THEN place the flag on that canvas correctly
                const flagIndex = itemsInOrder.indexOf("country");
                const flagImage = await sharp(images[flagIndex])
                    .resize(flagRectangle.width, flagRectangle.height)
                    .toBuffer();
                const canvas = await sharp({
                    create: {
                        width: 512,
                        height: 512,
                        channels: 4,
                        background: { r: 0, g: 0, b: 0, alpha: 0 }
                    }
                });
                await canvas.composite([{ input: flagImage, left: flagRectangle.x, top: flagRectangle.y }]).toBuffer();
                images[flagIndex] = await canvas.png().toBuffer();
            }

            // compose the images
            let image = sharp(images[0]);
            if (images.length > 1) {
                const composites = images.slice(1).map(img => ({ input: img, gravity: "center" }));
                image = image.composite(composites);
            }

            const output = await image.png().toBuffer();
            res.writeHead(200, {
                'Content-Type': 'image/png',
                'Content-Length': output.length
            });
            res.end(output);
        } catch (error) {
            console.error("Error composing avatar image:", error);
            res.status(500).send("Error composing avatar image");
        }
    }
);

module.exports = router;