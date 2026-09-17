/**
 * This module manages theme scoring implementations for World Dance Floor.
 * 
 * Each theme has its own logic for initializing state and generating screens.
 * This module exports functions to handle different themes.
 */

// Internal modules

// External modules
const cache = require("../lib/cache");
const logger = require("../lib/logger").createLogger({ service: "wdf/themes" });

// Scoring themes
var map = require("./scoring/map");
var teambattle = require("./scoring/teambattle");
var tournament = require("./scoring/tournament");
var boss = require("./scoring/boss");

const init = (clients) => {
    map.init(clients);
    teambattle.init(clients);
    tournament.init(clients);
    boss.init(clients);
    return;
};


module.exports = {
    init,
    "map": map,
    "teambattle": teambattle,
    "tournament": tournament,
    "boss": boss
};