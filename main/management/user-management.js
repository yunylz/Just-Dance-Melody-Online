const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const User = require('../routes/model/User'); 


router.get('/user/v1/userlist', async (req, res) => {
  try {
    let filter = {};
    const { env } = req.query;
    
    if (env) {
      switch (env.toLowerCase()) {
        case 'patreon':
          filter.isPatreon = true;
          break;
        case 'dev':
          filter.isDev = true;
          break;
        case 'banned':
          filter.isBanned = true;
          break;
        case 'public':
          filter = {
            isDev: { $ne: true },
            isPatreon: { $ne: true },
            isBanned: { $ne: true }
          };
          break;
        default:
          return res.status(400).json({ error: `Invalid env parameter: ${env}.` });
      }
    }
    
    const users = await User.find(filter, 'userName profileId platformType').lean();
    
    const userList = {};
    users.forEach(user => {
      const key = `${user.userName}-${user.platformType}-${user.profileId}`;
      userList[key] = {
        userName: user.userName,
        profileId: user.profileId,
        platformType: user.platformType
      };
    });
    
    res.json(userList);
  } catch (error) {
    console.error('Error fetching user list:', error);
    res.status(500).json({ error: 'Error reading user mongo' });
  }
});
// Delete user by profileID
router.delete('/user/v1/:profileID', async (req, res) => {
  const { profileID } = req.params;
  try {
    const deletedUser = await User.findOneAndDelete({ profileId: profileID });
    if (deletedUser) {
      res.json({ message: `Usuario con ID ${profileID} eliminado exitosamente.` });
    } else {
      res.status(404).json({ error: 'Usuario no encontrado.' });
    }
  } catch (error) {
    console.error('Error while trying to delete user:', error);
    res.status(500).json({ error: 'Error al intentar eliminar el usuario.' });
  }
});

// Get profile by userName - returns just the profile object
router.post('/user/v1/getProfileId', async (req, res) => {
  const { profileId } = req.body;
  try {
    const user = await User.findOne({ profileId }).lean();
    if (user) {
      res.json({ [user.profileId]: user });
    } else {
      res.status(404).json({ error: `User with profileId "${profileId}" not found.` });
    }
  } catch (error) {
    console.error('Error al buscar el perfil del usuario:', error);
    res.status(500).json({ error: 'Error.' });
  }
});

router.get('/user/v1/stats', async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const devUsers = await User.countDocuments({ isDev: true });
    const patreonUsers = await User.countDocuments({ isPatreon: true });
    const bannedUsers = await User.countDocuments({ isBanned: true });
    const publicUsers = totalUsers - devUsers - patreonUsers - bannedUsers;

    res.json({
      Dev: devUsers,
      Patreon: patreonUsers,
      Public: publicUsers,
      Banned: bannedUsers,
      Total: totalUsers
    });
  } catch (error) {
    console.error('Error fetching user stats:', error);
    res.status(500).json({ error: 'Error extracting' });
  }
});

router.post('/user/v1/update/:profileID', async (req, res) => {
  const { profileID } = req.params;
  const { isDev, isPatreon, isBanned, userName } = req.body;

  try {
    // Build the update object dynamically based on provided fields
    const updateData = {};
    if (isDev !== undefined) updateData.isDev = isDev;
    if (isPatreon !== undefined) updateData.isPatreon = isPatreon;
    if (isBanned !== undefined) updateData.isBanned = isBanned;
    if (userName !== undefined) updateData.userName = userName;
	updateData.dateSinceEnv = new Date();
    // Update the user document in the database
    const updatedUser = await User.findOneAndUpdate(
      { profileId: profileID }, // Find user by profileID
      { $set: updateData },    // Update only the provided fields
      { new: true }            // Return the updated document
    );

    if (updatedUser) {
      res.json({ message: `User with ${profileID} updated.`, user: updatedUser });
    } else {
      res.status(404).json({ error: 'Usuario not found.' });
    }
  } catch (error) {
    console.error('Error while updating user:', error);
    res.status(500).json({ error: 'Error updating users.' });
  }
});

module.exports = router;