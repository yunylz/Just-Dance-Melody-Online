const mongoose = require('mongoose');

const dotwSchema = new mongoose.Schema({
  mapName: { type: String, required: true, unique: true },
  __class: String,
  score: Number,
  profileId: String,
  pid: String,
  gameVersion: String,
  rank: Number,
  name: String,
  avatar: Number,
  country: Number,
  platformId: String,
  alias: Number,
  aliasGender: Number,
  jdPoints: Number,
  portraitBorder: Number,
});

const Dotw = mongoose.model('Dotw', dotwSchema);
module.exports = Dotw;  // Export the model