const express = require('express');
const fs = require('fs');
const axios = require('axios');
const path = require('path');
const logger = require("../logger/logger");
const router = express.Router();

const getFilePath = (mapName, isPatreon, isDev) => {
  if (isDev) {
    return path.resolve(__dirname, `../data/maps/Dev/${mapName}.json`);
  } else if (isPatreon) {
    return path.resolve(__dirname, `../data/maps/Exclusive/${mapName}.json`);
  } else {
    return path.resolve(__dirname, `../data/maps/${mapName}.json`);
  }
};

const readJSONFile = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));

const writeJSONFile = (filePath, data) => fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');

// Function to update authorization files
const updateAuths = (mapName, isPatreon,isDev) => {
  const mapFilesPath = path.join(__dirname, '../database/Maps');
  const baseUrl = 'https://jdmo-cdn.c0llydoll.com';
  const mapFilePath = path.join(mapFilesPath, `${mapName}.json`);
  
  if (!fs.existsSync(mapFilePath)) {
    throw new Error(`File for mapName ${mapName} not found.`);
  }

  const mapData = readJSONFile(mapFilePath);

  const urls = mapData.urls || {};
  const filteredUrls = Object.keys(urls)
    .filter((key) => !key.includes('MapPreviewNoSoundCrop') && !key.includes('AudioPreview'))
    .reduce((acc, key) => {
      acc[key] = `${baseUrl}${urls[key]}`;
      return acc;
    }, {});


  const hdVersions = ['LOW', 'MID', 'HIGH', 'ULTRA'];
  hdVersions.forEach((quality) => {
    const baseKey = `jmcs://jd-contents/${mapName}/${mapName}_${quality}.webm`;
    const hdKey = `jmcs://jd-contents/${mapName}/${mapName}_${quality}.hd.webm`;
    if (filteredUrls[baseKey] && !filteredUrls[hdKey]) {
      filteredUrls[hdKey] = filteredUrls[baseKey];
    }
  });

 
  const ultraBaseKey = `jmcs://jd-contents/${mapName}/${mapName}_ULTRA.webm`;
  const ultraHdKey = `jmcs://jd-contents/${mapName}/${mapName}_ULTRA.hd.webm`;
  if (!filteredUrls[ultraHdKey] && filteredUrls[ultraBaseKey]) {
    filteredUrls[ultraHdKey] = filteredUrls[ultraBaseKey];
  }

  const ultra1HdKey = `jmcs://jd-contents/${mapName}/${mapName}_ULTRA.webm`;
  const highHdKey = `jmcs://jd-contents/${mapName}/${mapName}_HIGH.hd.webm`;
  if (filteredUrls[ultra1HdKey] && !filteredUrls[highHdKey]) {
  	filteredUrls[highHdKey] = filteredUrls[ultra1HdKey];
  }
  const authData = {
    __class: 'ContentAuthorizationEntry',
    duration: 300,
    changelist: 0,
    urls: filteredUrls,
  };

  const authFilePath = getFilePath(mapName, isPatreon,isDev);
  let existingData = {};
  let changes = [];

  if (fs.existsSync(authFilePath)) {
    existingData = readJSONFile(authFilePath);
    const existingUrls = existingData.urls || {};

    for (const key in filteredUrls) {
      if (filteredUrls.hasOwnProperty(key)) {
        if (existingUrls[key] !== filteredUrls[key]) {
          changes.push({
            field: key,
            before: existingUrls[key] || 'Not present',
            now: filteredUrls[key]
          });
        }
      }
    }
  }

  writeJSONFile(authFilePath, authData);

  return { action: fs.existsSync(authFilePath) ? 'Updated' : 'Added', changes };
};

router.post('/songdb/v1/update-auth', (req, res) => {
  const { mapName, isPatreon,isDev } = req.body;

  if (!mapName) {
    return res.status(400).json({ error: 'mapName is required' });
  }

  try {
    const result = updateAuths(mapName, isPatreon,isDev);
    res.status(200).json({
      mapName,
      Action: result.action,
      Changes: result.changes
    });
  } catch (error) {
    logger.error(error,'Song Manager Authorization Content Module Error while updating files');
    res.status(500).json({ error: `Internal Server Error` });
  }
});

router.post('/wdf/v1/enable-weekly', async (req, res) => {
  try {
    const response = await axios.post('http://127.0.0.1:8473/wdf/handler/enableWeekly');
    res.status(200).json(response.data);
  } catch (error) {
    logger.error(error, 'Error calling enableWeekly API');
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

router.get('/wdf/v1/status-weekly', async (req, res) => {
  try {
    const response = await axios.get('http://127.0.0.1:8473/wdf/handler/weeklyStatus');
    res.status(200).json(response.data);
  } catch (error) {
    logger.error(error, 'Error calling statusWeekly API');
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

const getRandomInRange = (min, max) => {
    return Math.floor(Math.random() * (max - min + 1)) + min;
};

module.exports = router;
