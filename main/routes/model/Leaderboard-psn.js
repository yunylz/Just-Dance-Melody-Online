const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const leaderboardEntrySchema = new Schema({
  __class: { type: String, default: 'LeaderboardEntry_Online' },
  profileId: { type: String, required: true },
  rank: { type: Number, required: false },
  score: { type: Number, required: false },
  name: { type: String, required: false },
  avatar: { type: Number, required: false },
  skin: { type: Number, required: false },
  country: { type: Number, required: false },
  platform: { type: String, required: true },
  alias: { type: Number, required: false },
  aliasGender: { type: Number, required: false },
  jdPoints: { type: Number, required: false },
  portraitBorder: { type: Number, required: false }
});

const leaderboardSchema = new Schema({
  Codename: { type: String, required: true },
  entries: [leaderboardEntrySchema]
});

// Middleware para ordenar las entradas por puntaje (score) en orden descendente
leaderboardSchema.pre('save', function (next) {
  try {
    // Ordena los entries antes de guardar el documento
    this.entries.sort((a, b) => b.score - a.score);

    // Actualiza los ranks después de ordenar
    this.entries.forEach((entry, index) => {
      entry.rank = index + 1;
    });

    next();
  } catch (error) {
    next(error); // Propaga cualquier error que ocurra durante la ordenación
  }
});

const Leaderboard = mongoose.model('leaderboard-psn', leaderboardSchema);
module.exports = Leaderboard;
