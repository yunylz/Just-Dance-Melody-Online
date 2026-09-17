// External modules
const mongoose = require('mongoose');

// Internal modules
const config = require("../config");
const logger = require("./logger").createLogger({ service: "mongodb" });


const init = () => {
    mongoose.connect(config.MONGODB.URI);

    const db = mongoose.connection;

    db.on("error", (err) => {
        logger.error("MongoDB connection error: " + err.stack);
    });

    db.once("open", () => {
        logger.info("Connected!");
    });
};


module.exports = {
    init
};