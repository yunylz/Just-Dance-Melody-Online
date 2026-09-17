const mongoose = require('mongoose');
const logger = require("../logger/logger");
mongoose.connect('mongodb://flopJDMO:A3k%246NwjeO2b%40%21@127.0.0.1:27017/jdmo?authSource=admin', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});

const db = mongoose.connection;

db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  logger.info('JDMO Connected to MongoDB');
});

module.exports = db;  
