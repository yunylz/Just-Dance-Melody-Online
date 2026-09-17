const fs = require('fs');
const path = require('path');
const logger = require("../logger/logger");
const songdbDirectory = path.join(__dirname, '../data/songdb');
const mapsDirectory = path.join(__dirname, '../data/maps');
const exclusiveMapsDirectory = path.join(mapsDirectory, 'exclusive');
const devMapsDirectory = path.join(mapsDirectory, 'dev');

function deleteMap(req, res) {
    const { mapName, Source } = req.body;

    if (!mapName) {
        return res.status(400).json({ error: 'mapName is required' });
    }

    if (!Source || !['dev','all', 'patreon'].includes(Source.toLowerCase())) {
        return res.status(400).json({ error: 'Source should be "all" or "patreon"' });
    }

    const consoles = ['nx', 'pc', 'ps4'];
    let actionsTaken = [];

    consoles.forEach(console => {
        const consoleAllFileName = `jdmelody-${console}-all.json`;
        const consoleAllFilePath = path.join(songdbDirectory, consoleAllFileName);
        const consolePatreonFileName = `jdmelody-${console}-patreon.json`;
        const consolePatreonFilePath = path.join(songdbDirectory, consolePatreonFileName);
		const consoleDevFileName = `jdmelody-${console}-dev.json`;
        const consoleDevFilePath = path.join(songdbDirectory, consoleDevFileName);

        const deleteFromFile = (filePath) => {
            if (fs.existsSync(filePath)) {
                let existingData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

                if (existingData[mapName]) {
                    delete existingData[mapName];
                    fs.writeFileSync(filePath, JSON.stringify(existingData, null, 2));
                    actionsTaken.push(`Deleted from ${path.basename(filePath)}`);
                    logger.info(`Deleted ${mapName} from ${path.basename(filePath)}`);
                }
            }
        };

        if (Source.toLowerCase() === 'all') {
            deleteFromFile(consoleAllFilePath);
            deleteFromFile(consolePatreonFilePath);
        } else if (Source.toLowerCase() === 'patreon') {
            deleteFromFile(consolePatreonFilePath); 
		} else if (Source.toLowerCase() === 'dev') {
            deleteFromFile(consoleDevFilePath);
        }
    });

    const deleteMapFile = (filePath) => {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            actionsTaken.push(`Deleted file ${path.basename(filePath)}`);
            logger.info(`Deleting map ${path.basename(filePath)}`);
        }
    };

    const mapFilePath = path.join(mapsDirectory, `${mapName}.json`);
    const exclusiveMapFilePath = path.join(exclusiveMapsDirectory, `${mapName}.json`);

    if (Source.toLowerCase() === 'all') {
        deleteMapFile(mapFilePath);
        deleteMapFile(exclusiveMapFilePath);
    } else if (Source.toLowerCase() === 'patreon') {
        deleteMapFile(exclusiveMapFilePath);
	} else if (Source.toLowerCase() === 'dev') {
        deleteMapFile(devMapsDirectory);
    }

    res.status(200).json({
        mapName,
        Actions: actionsTaken.length ? actionsTaken : 'mapName not found'
    });
}

module.exports = deleteMap;
