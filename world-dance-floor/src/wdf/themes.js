/**
 * This module manages theme implementations for World Dance Floor.
 * 
 * Each theme has its own logic for handling scores & recaps.
 */

// Internal modules

// External modules
const cache = require("../lib/cache");
const logger = require("../lib/logger").createLogger({ service: "wdf/themes" });

// Themes
var map = require("./themes/map");
var vote = require("./themes/vote");
var teambattle = require("./themes/teambattle");
var tournament = require("./themes/tournament");
var boss = require("./themes/boss");

const init = (clients) => {
    map.initModule(clients);
    vote.initModule(clients);
    teambattle.initModule(clients);
    tournament.initModule(clients);
    boss.initModule(clients);
    return;
};


module.exports = {
    init,
    "map": map,
    "vote": vote,
    "teambattle": teambattle,
    "tournament": tournament,
    "boss": boss
};