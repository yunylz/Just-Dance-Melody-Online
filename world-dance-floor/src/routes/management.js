// External modules
const express = require("express");

// Internal modules
const cache = require("../lib/cache");
const middlewares = require("../lib/middlewares");

var clients;

const router = express.Router();

/**
 * Base routes
 */
module.exports = (clientsList) => {
    clients = clientsList;
    return router;
};