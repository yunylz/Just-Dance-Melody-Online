// External modules

// Internal modules
const cache = require("../lib/cache");
const logger = require("../lib/logger").createLogger({ service: "wdf/newsfeed" });
const redis = require("../lib/redis").client;

// WDF modules
const wdfConfig = cache.file("/data/config.json");
var wdfStats;

var currentNewsFeedKey = function(room) { return "wdf:rooms:" + room + ":news-feed-current" };
var preparedAutomaticEntriesKey = function(room) { return "wdf:rooms:" + room + ":news-feed-preparedAutomaticEntries" };

var allNewsFeedEntriesKey = "wdf:news-feed-entries"
var poolsKey = "wdf:news-feed-pools"
var poolsWithEntriesKey = "wdf:news-feed-pool-entry-map"
var variableRegex = /\[var:(.*?)\]/gi
var newsFeedTypes = {
	automatic: "automatic",
	countdown: "countdown",
	manual: "manual"
};

var defaultDisplayDuration = 3;


const init = (clients) => {

};