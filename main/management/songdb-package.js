const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const getFilePath = (mapName) => path.resolve(__dirname, `../database/Maps/${mapName}.json`);

router.post('/songdb/v1/songs/packages/:mapName', (req, res) => {
    const mapName = req.params.mapName;
    const filePath = getFilePath(mapName);

    let fileData = {};
    if (fs.existsSync(filePath)) {
        const rawData = fs.readFileSync(filePath);
        fileData = JSON.parse(rawData);
    }
    const updateData = req.body;
    for (let key in updateData) {
        if (fileData[key] && typeof fileData[key] === 'object' && !Array.isArray(fileData[key])) {
            fileData[key] = {
                ...fileData[key],
                ...updateData[key]
            };
        } else {
            fileData[key] = updateData[key];
        }
    }

    fs.writeFile(filePath, JSON.stringify(fileData, null, 2), (err) => {
        if (err) {
            console.error(`Error saving data to ${filePath}`, err);
            return res.status(500).json({
                error: 'Internal Server Error'
            });
        }
        console.log(`Saved data to ${filePath}`);
        res.status(200).json({
            success: true
        });
    });
});
router.get('/songdb/v1/songs/packages/:mapName', (req, res) => {
    const mapName = req.params.mapName;
    const filePath = getFilePath(mapName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Not Found' });
    }

    try {
        const rawData = fs.readFileSync(filePath);
        const fileData = JSON.parse(rawData);
        res.status(200).json(fileData);
    } catch (err) {
        console.error(`Error loading data from ${filePath}`,err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});
module.exports = router;