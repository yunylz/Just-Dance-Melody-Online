const fs = require('fs');
const path = require('path');
const log = console.log;
const mapsDirectory = path.join(__dirname, '../database/Maps');
const songdbDirectory = path.join(__dirname, '../data/songdb');
const cdnBaseUrl = 'https://jdmo-cdn.c0llydoll.com';
const mpdXml = require("./misc/MPD_Xml");
const logger = require("../logger/logger");
function processMaps(req, res) {
    const { mapName, isPatreon,isDev } = req.body;

    if (!mapName) {
        return res.status(400).json({ error: 'MAP NAME is required' });
    }

    const mapFilePath = path.join(mapsDirectory, `${mapName}.json`);

    if (!fs.existsSync(mapFilePath)) {
        return res.status(404).json({ error: `Map Name Not Found: ${mapName}` });
    }

    delete require.cache[require.resolve(mapFilePath)];
    const mapData = require(mapFilePath);
    let actionTaken = "Added";
    let changes = [];

    ['nx', 'pc', 'ps4'].forEach(console => {
        const consoleAllFileName = `jdmelody-${console}-all.json`;
        const consoleAllFilePath = path.join(songdbDirectory, consoleAllFileName);
        const consolePatreonFileName = `jdmelody-${console}-patreon.json`;
        const consolePatreonFilePath = path.join(songdbDirectory, consolePatreonFileName);
		const consoleDevFileName = `jdmelody-${console}-dev.json`;
        const consoleDevFilePath = path.join(songdbDirectory, consoleDevFileName);

        if (mapData.assets && mapData.assets[console]) {
            const consoleAssets = mapData.assets[console];
            const alignedAudioPreviewData = JSON.stringify(mapData.audioPreviewData)
                .replace(/\s+/g, ' ')
                .trim();

            const updatedConsoleAssets = {};
            for (let assetKey in consoleAssets) {
                if (consoleAssets.hasOwnProperty(assetKey)) {
                    const newUrl = `${cdnBaseUrl}${consoleAssets[assetKey]}`;
                    updatedConsoleAssets[assetKey] = newUrl;
                }
            }
			const phoneAssetKeys = ['phoneCoach1ImageUrl', 'phoneCoach2ImageUrl', 'phoneCoach3ImageUrl', 'phoneCoach4ImageUrl', 'phoneCoverImageUrl'];
			for (let assetKey of phoneAssetKeys) {
				if (mapData.assets.hasOwnProperty(assetKey) && mapData.assets[assetKey]) {
					const newUrl = `${cdnBaseUrl}${mapData.assets[assetKey]}`;
					updatedConsoleAssets[assetKey] = newUrl;
				}
			}
            const updatedUrls = {};
            for (let urlKey in mapData.urls) {
                if (mapData.urls.hasOwnProperty(urlKey)) {
                    const urlValue = mapData.urls[urlKey];
                    if (urlValue.includes('MapPreviewNoSoundCrop') || urlValue.includes('AudioPreview')) {
                        updatedUrls[urlKey] = `${cdnBaseUrl}${urlValue}`;
                    }
                }
            }
            
            const previewMPD = mpdXml({ mapName });
            const consoleData = {
                [mapName]: {
                    artist: mapData.data.artist,
                    assets: updatedConsoleAssets,
                    audioPreviewData: alignedAudioPreviewData,
                    coachCount: mapData.data.coachCount,
                    credits: mapData.data.credits,
                    difficulty: mapData.data.difficulty,
                    jdmAttributes: [],
                    lyricsColor: mapData.data.lyricsColor.slice(1).toUpperCase() + 'FF',
                    lyricsType: 0,
                    mainCoach: -1,
                    mapLength: mapData.mapLength || 300,
                    mapName: mapData.data.mapName,
                    mapPreviewMpd: mapData.mapPreviewMpd || previewMPD,
                    mode: 6,
                    originalJDVersion: mapData.data.originalJDVersion || 9999,
                    packages: {
                        mapContent: `${mapName}_mapContent`
                    },
                    parentMapName: mapData.data.mapName,
                    skuIds: [`jdmelody-${console}-all`],
                    songColors: {
                        songColor_1A: mapData.data.songColor1A.slice(1).toUpperCase() + 'FF',
                        songColor_1B: mapData.data.songColor1B.slice(1).toUpperCase() + 'FF',
                        songColor_2A: mapData.data.songColor2A.slice(1).toUpperCase() + 'FF',
                        songColor_2B: mapData.data.songColor2B.slice(1).toUpperCase() + 'FF',
                    },
                    status: 3,
                    sweatDifficulty: mapData.data.sweatDifficulty,
                    tags: mapData.data.tags,
                    title: mapData.data.title,
                    urls: updatedUrls,
                    serverChangelist: 0,
					...(mapData.data.LocaleID && mapData.data.LocaleID !== "4294967295" && { customTypeNameId: mapData.data.LocaleID })
                }
            };

            const writeConsoleData = (consoleFilePath) => {
                let existingData = {};
                if (fs.existsSync(consoleFilePath)) {
                    existingData = JSON.parse(fs.readFileSync(consoleFilePath, 'utf-8'));
                }

                if (existingData[mapName]) {
                    actionTaken = "Updated";
                    const existingMapData = existingData[mapName];
                    for (let key in consoleData[mapName]) {
                        if (consoleData[mapName].hasOwnProperty(key) && JSON.stringify(existingMapData[key]) !== JSON.stringify(consoleData[mapName][key])) {
                            changes.push({
                                field: key,
                                before: existingMapData[key],
                                now: consoleData[mapName][key]
                            });
                              existingData[mapName][key] = consoleData[mapName][key];
                        }
                    }
                } else {

                    existingData[mapName] = consoleData[mapName];
                }

                fs.writeFileSync(consoleFilePath, JSON.stringify(existingData, null, 2));
                logger.info(`Song DB Manager: Files ${actionTaken.toLowerCase()} for ${path.basename(consoleFilePath)}`);
            };

            if (isPatreon) {
                writeConsoleData(consolePatreonFilePath);
            } else if (isDev) {
				writeConsoleData(consoleDevFilePath);
			}
			else {
                writeConsoleData(consoleAllFilePath);
                writeConsoleData(consolePatreonFilePath);
				writeConsoleData(consoleDevFilePath);
            }
        }
    });

    res.status(200).json({
        mapName,
        Action: actionTaken,
        Changes: changes
    });
}

module.exports = processMaps;
