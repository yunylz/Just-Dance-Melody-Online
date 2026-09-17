const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const Dotw = require('../routes/model/Dotw');

const resetDotwsCollection = async () => {
  try {
    await Dotw.deleteMany({});  // Deletes all documents in the Dotw collection
    console.log('DOTW collection reset successful');
  } catch (err) {
    console.error('Error resetting DOTW collection:', err);
    throw new Error('Error resetting DOTW collection');
  }
};

router.post('/leaderboard/v1/delete-dotws', async (req, res) => {

  try {
    await resetDotwsCollection();  // Call the function to clear the collection
    res.status(200).json({ message: 'DOTW reset successful' });
  } catch (error) {
    console.error('Error resetting DOTW collection:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
const jdmelodyNxAllPath = path.resolve(__dirname, '../data/songdb/jdmelody-nx-all.json');
const recommendedFilePath = path.resolve(__dirname, '../data/songdb/recommended.json');

const playlistsFilePath = path.resolve(__dirname, '../data/playlistdb/playlist.json');

const resetRecommendedFile = () => {
  fs.readFile(jdmelodyNxAllPath, 'utf8', (err, data) => {
    if (err) {
      console.error('Error reading jdmelody-nx-all.json:', err);
      throw new Error('Error reading jdmelody-nx-all.json');
    }

    let jdmelodyJson;
    try {
      jdmelodyJson = JSON.parse(data);
    } catch (parseError) {
      console.error('Error parsing jdmelody-nx-all.json:', parseError);
      throw new Error('Error parsing jdmelody-nx-all.json');
    }

    const allMapNames = Object.keys(jdmelodyJson);
    const randomMapNames = [];
    while (randomMapNames.length < 50) {
      const randomIndex = Math.floor(Math.random() * allMapNames.length);
      const selectedMap = allMapNames[randomIndex];
      
      if (!randomMapNames.includes(selectedMap)) {
        randomMapNames.push(selectedMap);
      }
    }

    fs.writeFile(recommendedFilePath, JSON.stringify(randomMapNames, null, 2), (err) => {
      if (err) {
        console.error('Error writing recommended.json:', err);
        throw new Error('Error writing recommended.json');
      }
      console.log('Recommended.json updated successfully');
    });


    fs.readFile(playlistsFilePath, 'utf8', (err, playlistData) => {
      if (err) {
        console.error('Error reading playlists.json:', err);
        throw new Error('Error reading playlists.json');
      }

      let playlistsJson;
      try {
        playlistsJson = JSON.parse(playlistData);
      } catch (parseError) {
        console.error('Error parsing playlists.json:', parseError);
        throw new Error('Error parsing playlists.json');
      }
      if (
        playlistsJson &&
        playlistsJson.db &&
        playlistsJson.db["reco-for_you"]
      ) {
        playlistsJson.db["reco-for_you"].maps = randomMapNames;

        fs.writeFile(playlistsFilePath, JSON.stringify(playlistsJson, null, 2), (err) => {
          if (err) {
            console.error('Error writing playlists.json:', err);
            throw new Error('Error writing playlists.json');
          }
          console.log('Playlists.json updated successfully');
        });
      } else {
        console.error('reco-for_you structure not found in playlists.json');
        throw new Error('Invalid playlists.json structure');
      }
    });
  });
};
router.post('/songdb/v1/reset-recommended', (req, res) => {

  try {
    resetRecommendedFile();
    res.status(200).json({ message: 'Recommended songs reset successful' });
    console.log('Recommended songs reset successful');
  } catch (error) {
    console.error('Error resetting recommended.json:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;