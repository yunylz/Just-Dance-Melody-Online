const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  userId: { type: String, required: false },
  profileId: { type: String, required: true, unique: true },
  userName: { type: String, required: true },
  isPatreon: { type: Boolean, default: false },
  isBanned: { type: Boolean, default: false },
  isDev: { type: Boolean, default: false },
  platformType: { type: String, required: true },
  firstLoginTime: { type: Date, default: Date.now },
  lastTimeLogged: { type: Date, default: Date.now },
  dateSinceEnv: { type: Date, default: Date.now },
  discordId: { type: String, required: false },
  verificationCode: { type: String, required: false }
});

const User = mongoose.model('User', userSchema);

module.exports = User;