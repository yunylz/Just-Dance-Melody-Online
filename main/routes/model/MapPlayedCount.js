const mongoose = require('mongoose');

const MapPlayedCountSchema = new mongoose.Schema({
  mapName: { type: String, required: true, unique: true },
  mapCountByCountry: { 
    type: Map, 
    of: Number, 
    default: {} 
  },
});

module.exports = mongoose.model('MapPlayedCount', MapPlayedCountSchema);