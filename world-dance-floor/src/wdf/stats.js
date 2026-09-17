// External modules

// Internal modules
const cache = require("../lib/cache");
const logger = require("../lib/logger").createLogger({ service: "wdf/stats" });
const redis = require("../lib/redis").client;

// WDF modules
var wdfSchedule;
var wdfSessions;

var bossDb = cache.file("/data/bosses.json").bosses;
var themeStats = {};
var lib = {};

// stats
themeStats.boss = (async function() {
    var keys = {
		"totalStars": function(room) { return "wdf:rooms:" + room + ":stats:boss:stars-total" },
		"currentBossFamilyName": function(room) { return "wdf:rooms:" + room + ":stats:boss:currentBossFamilyName" },
		"bossBeatenCount": function(room, level) { return "wdf:rooms:" + room + ":stats:boss:boss" + level + "BeatenCount" },
		"bossName": function(room, level) { return "wdf:rooms:" + room + ":stats:boss:boss" + level + "Name" },
		"pictureUrl": function(room, level) { return "wdf:rooms:" + room + ":stats:boss:boss" + level + "PictureUrl" },
		"playerBossBeatCounts": function(room) { return "wdf:rooms:" + room + ":stats:boss:player-boss-beatenCount" },
		"lastWeekMostBossesBeatenPlayer": function(room) { return "wdf:rooms:" + room + ":stats:boss:lastWeekMostBossesBeatenPlayer" },
		"currentWeekMostBossesBeatenPlayer": function(room) { return "wdf:rooms:" + room + ":stats:boss:currentWeekMostBossesBeatenPlayer" },
		"lastWeekPlayerComputeTime": function(room) { return "wdf:rooms:" + room + ":stats:boss:lastWeekPlayerComputeTime" }
    };

    var totalStars = {
        get: async function(room) {
            var value = await redis.get(keys.totalStars(room));

            if (!value) return null;

            try {
                value = parseInt(value);
            } catch (err) {
                logger.error(`themeStats::boss::totalStars::get(): Error parsing totalStars value for room '${room}': ${err.message}`);
                throw err;
            }

            return value;
        },
        put: async function(room, data) {
            if (data.stars) {
                try {
                    await redis.incrBy(keys.totalStars(room), data.stars);
                } catch (err) {
                    logger.error(`themeStats::boss::totalStars::put(): Error incrementing totalStars for room '${room}': ${err.message}`);
                    throw err;
                }
            }

            return;
        }
    };

    async function computeLastWeekPlayer(room) {
        var multi = redis.multi();

        // get the player who beat the most bosses this week, to store as the last week player
		multi.get(keys.currentWeekMostBossesBeatenPlayer(room))

		// reset the current week player-beatCount sorted set and the currentWeekMostBossesBeatenPlayer
		multi.del(keys.playerBossBeatCounts(room))
		multi.del(keys.currentWeekMostBossesBeatenPlayer(room))
        
        try {
            var replies = await multi.exec();

            if (replies && replies[0] && replies[0].length > 0) {
                await redis.set(keys.lastWeekMostBossesBeatenPlayer(room), replies[0]);
            }
        } catch (err) {
            logger.error(`themeStats::boss::computeLastWeekPlayer(): Error computing last week most bosses beaten player for room '${room}': ${err.message}`);
            throw err;
        }

        return;
    }

    async function preProcess(room, data) {
        var existingFamilyName = null;
        var now = Date.now();

        try {
            [
                keys.lastWeekMostBossesBeatenPlayer(room),
                keys.currentWeekMostBossesBeatenPlayer(room)
            ].forEach(async (key) => {
                await updatePlayerProfile(key, data.roomGameVersion);
            })
        } catch (err) {
            logger.error(`themeStats::boss::preProcess(): Error updating player profiles for room '${room}': ${err.message}`);
            throw err;
        }

        try {
            var value = await redis.get(keys.currentBossFamilyName(room));

            existingFamilyName = value;
        } catch (err) {
            logger.error(`themeStats::boss::preProcess(): Error getting currentBossFamilyName for room '${room}': ${err.message}`);
            throw err;
        }
        
        // check if we are one week ahead from the recent boss release
		// and compute the last week player
        try {
            var value = await redis.get(keys.lastWeekPlayerComputeTime(room));

            if (value) {
                try {
                    value = parseInt(value);
                } catch (err) {
                    throw err;
                }

                if (now >= value) {
                    // compute the last week player if it has been one week since the release of the boss
                    await computeLastWeekPlayer(room);

                    // delete the last week player compute time. The boss family change will set it next.
                    await redis.del(keys.lastWeekPlayerComputeTime(room));
                }
            }
        } catch (err) {
            logger.error(`themeStats::boss::preProcess(): Error computing last week player for room '${room}': ${err.message}`);
            throw err;
        }

        if (data.familyName && (existingFamilyName !== data.familyName)) {
            var multi = redis.multi();

            // reset the boss beaten counts if a new boss family has been released
			// set the time to compute the last week player - after one week from now
            multi.set(keys.lastWeekPlayerComputeTime(room), now + oneWeek)
			multi.set(keys.currentBossFamilyName(room), data.familyName)
			multi.del(keys.bossBeatenCount(room, 1))
			multi.del(keys.bossBeatenCount(room, 2))
			multi.del(keys.bossBeatenCount(room, 3))
			multi.del(keys.bossName(room, 1))
			multi.del(keys.bossName(room, 2))
			multi.del(keys.bossName(room, 3))
			multi.del(keys.pictureUrl(room, 1))
			multi.del(keys.pictureUrl(room, 2))
			multi.del(keys.pictureUrl(room, 3))

            try {
                await multi.exec();

                await computeLastWeekPlayer(room);
            } catch (err) {
                logger.error(`themeStats::boss::preProcess(): Error resetting boss stats for room '${room}': ${err.message}`);
                throw err;
            }
        }

        if (data.level && data.beaten) {
            try {
                await redis.incr(keys.bossBeatenCount(room, data.level));
            } catch (err) {
                logger.error(`themeStats::boss::preProcess(): Error incrementing bossBeatenCount for room '${room}', level '${data.level}': ${err.message}`);
                throw err;
            }
        }

        if (data.level && data.bossFullName) {
            try {
                await redis.set(keys.bossName(room, data.level), data.bossFullName);
            } catch (err) {
                logger.error(`themeStats::boss::preProcess(): Error setting bossName for room '${room}', level '${data.level}': ${err.message}`);
                throw err;
            }
        }

        if (data.level && data.bossName && bossDb.bosses && bossDb.bosses[data.bossName] && bossDb.bosses[data.bossName].newsFeedPictureUrl) {
            try {
                await redis.set(keys.pictureUrl(room, data.level), bossDb.bosses[data.bossName].newsFeedPictureUrl);
            } catch (err) {
                logger.error(`themeStats::boss::preProcess(): Error setting pictureUrl for room '${room}', level '${data.level}': ${err.message}`);
                throw err;
            }
        }
    }

    async function getBossBeatenCount(room, level) {
        try {
            var value = await redis.get(keys.bossBeatenCount(room, level));

            if (!value) return null;

            try {
                value = parseInt(value);
            } catch (err) {
                logger.error(`themeStats::boss::getBossBeatenCount(): Error parsing bossBeatenCount value for room '${room}', level '${level}': ${err.message}`);
                throw err;
            }

            return value;
        } catch (err) {
            logger.error(`themeStats::boss::getBossBeatenCount(): Error getting bossBeatenCount for room '${room}', level '${level}': ${err.message}`);
            throw err;
        }
    }

    async function getBossName(room, level) {
        try {
            var value = await redis.get(keys.bossName(room, level));

            if (!value) return null;

            return value;
        } catch (err) {
            logger.error(`themeStats::boss::getBossName(): Error getting bossName for room '${room}', level '${level}': ${err.message}`);
            throw err;
        }
    }

    async function getBossPictureUrl(room, level) {
        try {
            var value = await redis.get(keys.pictureUrl(room, level));

            if (!value) return null;

            return value;
        } catch (err) {
            logger.error(`themeStats::boss::getBossPictureUrl(): Error getting pictureUrl for room '${room}', level '${level}': ${err.message}`);
            throw err;
        }
    }

    var boss1BeatenCount = {
        get: async function(room) {
            return await getBossBeatenCount(room, 1);
        },
        put: async function(room, data) {
            return;
        }
    };

    var boss2BeatenCount = {
        get: async function(room) {
            return await getBossBeatenCount(room, 2);
        },
        put: async function(room, data) {
            return;
        }
    };

    var boss3BeatenCount = {
        get: async function(room) {
            return await getBossBeatenCount(room, 3);
        },
        put: async function(room, data) {
            return;
        }
    };

    var boss1Name = {
        get: async function(room) {
            return await getBossName(room, 1);
        },
        put: async function(room, data) {
            return;
        }
    };

    var boss2Name = {
        get: async function(room) {
            return await getBossName(room, 2);
        },
        put: async function(room, data) {
            return;
        }
    };

    var boss3Name = {
        get: async function(room) {
            return await getBossName(room, 3);
        },
        put: async function(room, data) {
            return;
        }
    };

    var boss1PictureUrl = {
        get: async function(room) {
            return await getBossPictureUrl(room, 1);
        },
        put: async function(room, data) {
            return;
        }
    };

    var boss2PictureUrl = {
        get: async function(room) {
            return await getBossPictureUrl(room, 2);
        },
        put: async function(room, data) {
            return;
        }
    };

    var boss3PictureUrl = {
        get: async function(room) {
            return await getBossPictureUrl(room, 3);
        },
        put: async function(room, data) {
            return;
        }
    };

    var currentWeekMostBossesBeatenPlayer = {
        get: async function(room) {
            try {
                var value = await redis.get(keys.currentWeekMostBossesBeatenPlayer(room));

                if (value) {
                    try {
                        value = JSON.parse(value);
                    } catch (err) {
                        logger.error(`themeStats::boss::currentWeekMostBossesBeatenPlayer::get(): Error parsing currentWeekMostBossesBeatenPlayer value for room '${room}': ${err.message}`);
                        throw err;
                    }

                    return value;
                }

                return null;
            } catch (err) {
                logger.error(`themeStats::boss::currentWeekMostBossesBeatenPlayer::get(): Error getting currentWeekMostBossesBeatenPlayer for room '${room}': ${err.message}`);
                throw err;
            }
        },
        put: async function(room, data) {
            if (data.beaten && data.players && Array.isArray(data.players)) {
                var multi = redis.multi();

                data.players.forEach((pid) => {
                    multi.zIncrBy(keys.playerBossBeatCounts(room), 1, pid);
                });

                multi.zRange(keys.playerBossBeatCounts(room), -1, -1);

                multi.get(keys.currentWeekMostBossesBeatenPlayer(room));

                try {
                    var results = await multi.exec();

                    var existingMostBossesBeatenPlayer = results[results.length - 1];
                    var mostBossesBeatenPlayerResult = results[results.length - 2];
                    var mostBossesBeatenPlayer = mostBossesBeatenPlayerResult && mostBossesBeatenPlayerResult[0];

                    // No players have beaten any bosses yet
                    if (!mostBossesBeatenPlayer) return;

                    try {
                        existingMostBossesBeatenPlayer = JSON.parse(existingMostBossesBeatenPlayer);
                    } catch (err) {
                        logger.error(`themeStats::boss::currentWeekMostBossesBeatenPlayer::put(): Error parsing existingMostBossesBeatenPlayer value for room '${room}': ${err.message}`);
                        throw err;
                    }

                    if (existingMostBossesBeatenPlayer && (existingMostBossesBeatenPlayer.pid === mostBossesBeatenPlayer)) {
                        // no change
                        return;
                    }

                    var playerInfo = await wdfSessions.getPlayerInfo({
                        room: room,
                        pids: [ mostBossesBeatenPlayer ]
                    });

                    if (!playerInfo || !playerInfo[0]) return;

                    playerInfo[0].pid = mostBossesBeatenPlayer;

                    await redis.set(keys.currentWeekMostBossesBeatenPlayer(room), JSON.stringify(playerInfo[0]));
                } catch (err) {
                    logger.error(`themeStats::boss::currentWeekMostBossesBeatenPlayer::put(): Error updating currentWeekMostBossesBeatenPlayer for room '${room}': ${err.message}`);
                    throw err;
                }
            }

            return;
        },
        isPlayerStat: true
    };

    var lastWeekMostBossesBeatenPlayer = {
        get: async function(room) {
            try {
                var value = await redis.get(keys.lastWeekMostBossesBeatenPlayer(room));

                if (value) {
                    try {
                        value = JSON.parse(value);
                    } catch (err) {
                        logger.error(`themeStats::boss::lastWeekMostBossesBeatenPlayer::get(): Error parsing lastWeekMostBossesBeatenPlayer value for room '${room}': ${err.message}`);
                        throw err;
                    }

                    return value;
                }

                return null;
            } catch (err) {
                logger.error(`themeStats::boss::lastWeekMostBossesBeatenPlayer::get(): Error getting lastWeekMostBossesBeatenPlayer for room '${room}': ${err.message}`);
                throw err;
            }
        },
        put: async function(room, data) {
            return;
        },
        isPlayerStat: true
    };

    return {
        preProcess: preProcess,
        stats: {
            totalStars,
            boss1Name,
            boss2Name,
            boss3Name,
            boss1PictureUrl,
            boss2PictureUrl,
            boss3PictureUrl,
            boss1BeatenCount,
            boss2BeatenCount,
            boss3BeatenCount,
            currentWeekMostBossesBeatenPlayer,
            lastWeekMostBossesBeatenPlayer
        }
    }
}())

themeStats.vote = (async function() {
    var keys = {
		"stars": function(room) { return "wdf:rooms:" + room + ":stats:vote:stars" },
		"totalStars": function(room) { return "wdf:rooms:" + room + ":stats:vote:stars-total" },
		"mostVotedTrack": function(room) { return "wdf:rooms:" + room + ":stats:vote:voted-tracks" },
		"maxStarsMap": function(room) { return "wdf:rooms:" + room + ":stats:vote:max-stars-map" },
	};

    async function putStars(room, data) {
        if (data.stars) {
            try {
                await redis.incrBy(keys.stars(room), data.stars);
            } catch (err) {
                logger.error(`themeStats::vote::putStars(): Error incrementing starsSku for room '${room}': ${err.message}`);
                throw err;
            }

            try {
                await redis.incrBy(keys.totalStars(room), data.stars);
            } catch (err) {
                logger.error(`themeStats::vote::putStars(): Error incrementing totalStars for room '${room}': ${err.message}`);
                throw err;
            }

            if (data.mapName) {
                try {
                    await redis.zIncrBy(keys.maxStarsMap(room), data.stars, data.mapName);
                } catch (err) {
                    logger.error(`themeStats::vote::putStars(): Error incrementing maxStarsMap for room '${room}': ${err.message}`);
                    throw err;
                }
            }
        }

        return;
    }

    async function preProcess(room, data) {
        try {
            await putStars(room, data);
        } catch (err) {
            logger.error(`themeStats::vote::preProcess(): Error in putStars for room '${room}': ${err.message}`);
            throw err;
        }
    }

    var mostVotedTrackEver = {
        get: async function(room) {
            try {
                var value = await redis.zRange(keys.mostVotedTrack(room), -1, -1);

                if (!value || value.length <= 0) return null;

                return value[0];
            } catch (err) {
                logger.error(`themeStats::vote::mostVotedTrackEver::get(): Error getting mostVotedTrackEver for room '${room}': ${err.message}`);
                throw err;
            }
        },
        put: async function(room, data) {
            if (data.mapName) {
                try {
                    await redis.zIncrBy(keys.mostVotedTrack(room), 1, data.mapName);
                } catch (err) {
                    logger.error(`themeStats::vote::mostVotedTrackEver::put(): Error incrementing mostVotedTrackEver for room '${room}': ${err.message}`);
                    throw err;
                }
            }
            return;
        }
    };

    var totalStars = {
        get: async function(room) {
            try {
                var value = await redis.get(keys.totalStars(room));

                if (!value) return null;

                try {
                    value = parseInt(value);
                } catch (err) {
                    logger.error(`themeStats::vote::totalStars::get(): Error parsing totalStars value for room '${room}': ${err.message}`);
                    throw err;
                }

                return value;
            } catch (err) {
                logger.error(`themeStats::vote::totalStars::get(): Error getting totalStars for room '${room}': ${err.message}`);
                throw err;
            }
        },
        put: async function(room, data) {
            return;
        }
    };

    var stars = {
        get: async function(room) {
            try {
                var value = await redis.get(keys.stars(room));

                if (!value) return null;

                try {
                    value = parseInt(value);
                } catch (err) {
                    logger.error(`themeStats::vote::stars::get(): Error parsing stars value for room '${room}': ${err.message}`);
                    throw err;
                }

                return value;
            } catch (err) {
                logger.error(`themeStats::vote::stars::get(): Error getting stars for room '${room}': ${err.message}`);
                throw err;
            }
        },
        put: async function(room, data) {
            return;
        }
    };

    var maxStarsMap = {
        get: async function(room) {
            try {
                var value = await redis.zRange(keys.maxStarsMap(room), -1, -1);

                if (!value || value.length <= 0) return null;

                return value[0];
            } catch (err) {
                logger.error(`themeStats::vote::maxStarsMap::get(): Error getting maxStarsMap for room '${room}': ${err.message}`);
                throw err;
            }
        },
        put: async function(room, data) {
            return;
        }
    };

    var maxStarsMapStarCount = {
        get: async function(room) {
            try {
                var value = await redis.zRangeWithScores(keys.maxStarsMap(room), -1, -1);

                if (!value || value.length <= 0) return null;

                try {
                    value[1] = parseInt(value[1]);
                } catch (err) {
                    logger.error(`themeStats::vote::maxStarsMapStarCount::get(): Error parsing maxStarsMapStarCount value for room '${room}': ${err.message}`);
                    throw err;
                }

                return value[1];
            } catch (err) {
                logger.error(`themeStats::vote::maxStarsMapStarCount::get(): Error getting maxStarsMapStarCount for room '${room}': ${err.message}`);
                throw err;
            }
        },
        put: async function(room, data) {
            return;
        }
    };

    return {
        preProcess: preProcess,
        stats: {
            stars,
            totalStars,
            mostVotedTrackEver,
            maxStarsMap,
            maxStarsMapStarCount
        }
    };
}());

themeStats.spotlight = (async function() {
    var keys = {
		"totalStars": function(room) { return "wdf:rooms:" + room + ":stats:spotlight:stars-total" },
		"spotlightGuestBeatenCount": function(room) { return "wdf:rooms:" + room + ":stats:spotlight:spotlightGuestBeatenCount" },
		"totalUniquePlayersSpotlighted": function(room) { return "wdf:rooms:" + room + ":stats:spotlight:totalUniquePlayersSpotlighted" },
		"totalMojos": function(room) { return "wdf:rooms:" + room + ":stats:spotlight:totalMojos" },
		"maxCommunitySize": function(room) { return "wdf:rooms:" + room + ":stats:spotlight:maxCommunitySize" },
	};

    var totalStars = {
        get: async function(room) {
            var value = await redis.get(keys.totalStars(room));

            if (!value) return null;

            try {
                value = parseInt(value);
            } catch (err) {
                logger.error(`themeStats::spotlight::totalStars::get(): Error parsing totalStars value for room '${room}': ${err.message}`);
                throw err;
            }
            return value;
        },
        put: async function(room, data) {
            if (data.stars) {
                try {
                    await redis.incrBy(keys.totalStars(room), data.stars);
                } catch (err) {
                    logger.error(`themeStats::spotlight::totalStars::put(): Error incrementing totalStars for room '${room}': ${err.message}`);
                    throw err;
                }
            }

            return;
        }
    };

    var totalMojos = {
        get: async function(room) {
            try {
                var value = await redis.get(keys.totalMojos(room));

                if (!value) return null;

                try {
                    value = parseInt(value);
                } catch (err) {
                    logger.error(`themeStats::spotlight::totalMojos::get(): Error parsing totalMojos value for room '${room}': ${err.message}`);
                    throw err;
                }
            } catch (err) {
                logger.error(`themeStats::spotlight::totalMojos::get(): Error getting totalMojos for room '${room}': ${err.message}`);
                throw err;
            }
        },
        put: async function(room, data) {
            if (data.mojos) {
                try {
                    await redis.incrBy(keys.totalMojos(room), data.mojos);
                } catch (err) {
                    logger.error(`themeStats::spotlight::totalMojos::put(): Error incrementing totalMojos for room '${room}': ${err.message}`);
                    throw err;
                }
            }

            return;
        }
    };

    var totalUniquePlayersSpotlighted = {
        get: async function(room) {
            try {
                var value = await redis.sCard(keys.totalUniquePlayersSpotlighted(room));

                if (!value) return null;

                try {
                    value = parseInt(value);
                } catch (err) {
                    logger.error(`themeStats::spotlight::totalUniquePlayersSpotlighted::get(): Error parsing totalUniquePlayersSpotlighted value for room '${room}': ${err.message}`);
                    throw err;
                }

                return value;
            } catch (err) {
                logger.error(`themeStats::spotlight::totalUniquePlayersSpotlighted::get(): Error getting totalUniquePlayersSpotlighted for room '${room}': ${err.message}`);
                throw err;
            }
        },
        put: async function(room, data) {
            if (data.spotlightedPlayer) {
                try {
                    await redis.sAdd(keys.totalUniquePlayersSpotlighted(room), data.spotlightedPlayer);
                } catch (err) {
                    logger.error(`themeStats::spotlight::totalUniquePlayersSpotlighted::put(): Error adding to totalUniquePlayersSpotlighted for room '${room}': ${err.message}`);
                    throw err;
                }
            }
            return;
        }
    };

    return {
        stats: {
            totalStars,
            totalMojos,
            totalUniquePlayersSpotlighted
        }
    }
}());

themeStats.teambattle = (async function() {
    var keys = {
		"totalStars": function(room) { return "wdf:rooms:" + room + ":stats:teambattle:stars-total" },
		"totalPlayCount": function(room) { return "wdf:rooms:" + room + ":stats:teambattle:totalPlayCount" },
	};

    var totalStars = {
        get: async function(room) {
            var value = await redis.get(keys.totalStars(room));

            if (!value) return null;

            try {
                value = parseInt(value);
            } catch (err) {
                logger.error(`themeStats::teambattle::totalStars::get(): Error parsing totalStars value for room '${room}': ${err.message}`);
                throw err;
            }
            return value;
        },
        put: async function(room, data) {
            if (data.stars) {
                try {
                    await redis.incrBy(keys.totalStars(room), data.stars);
                } catch (err) {
                    logger.error(`themeStats::teambattle::totalStars::put(): Error incrementing totalStars for room '${room}': ${err.message}`);
                    throw err;
                }
            }
        }
    };

    var totalPlayCount = {
        get: async function(room) {
            try {
                var value = await redis.get(keys.totalPlayCount(room));

                if (!value) return null;

                try {
                    value = parseInt(value);
                } catch (err) {
                    logger.error(`themeStats::teambattle::totalPlayCount::get(): Error parsing totalPlayCount value for room '${room}': ${err.message}`);
                    throw err;
                }

                return value;
            } catch (err) {
                logger.error(`themeStats::teambattle::totalPlayCount::get(): Error getting totalPlayCount for room '${room}': ${err.message}`);
                throw err;
            }
        },
        put: async function(room, data) {
            try {
                await redis.incr(keys.totalPlayCount(room));
            } catch (err) {
                logger.error(`themeStats::teambattle::totalPlayCount::put(): Error incrementing totalPlayCount for room '${room}': ${err.message}`);
                throw err;
            }
        }
    };

    return {
        stats: {
            totalStars,
            totalPlayCount
        }
    }
}());

themeStats.tournament = (async function() {
    var keys = {
		"totalStars": function(room) { return "wdf:rooms:" + room + ":stats:tournament:stars-total" },
		"latestWinner": function(room) { return "wdf:rooms:" + room + ":stats:tournament:latestWinner" },
		"tournamentWinnersCount": function(room) { return "wdf:rooms:" + room + ":stats:tournament:tournamentWinnersCount" },
		"currentWeekMostTournamentsWinner": function(room) { return "wdf:rooms:" + room + ":stats:tournament:currentWeekMostTournamentsWinner" },
		"lastWeekMostTournamentsWinner": function(room) { return "wdf:rooms:" + room + ":stats:tournament:lastWeekMostTournamentsWinner" },
		"weeklyScheduledTournamentWinner": function(room) { return "wdf:rooms:" + room + ":stats:tournament:weeklyScheduledTournamentWinner" },
		"lastWeekPlayerComputeTime": function(room) { return "wdf:rooms:" + room  + ":stats:tournament:lastWeekPlayerComputeTime"}
	};

    var totalStars = {
        get: async function(room) {
            try {
                var value = await redis.get(keys.totalStars(room));

                if (!value) return null;

                try {
                    value = parseInt(value);
                } catch (err) {
                    logger.error(`themeStats::tournament::totalStars::get(): Error parsing totalStars value for room '${room}': ${err.message}`);
                    throw err;
                }

                return value;
            } catch (err) {
                logger.error(`themeStats::tournament::totalStars::get(): Error getting totalStars for room '${room}': ${err.message}`);
                throw err;
            }
        },
        put: async function(room, data) {
            if (data.stars) {
                try {
                    await redis.incrBy(keys.totalStars(room), data.stars);
                } catch (err) {
                    logger.error(`themeStats::tournament::totalStars::put(): Error incrementing totalStars for room '${room}': ${err.message}`);
                    throw err;
                }
            }
            return;
        }
    };

    var latestWinner = {
        get: async function(room) {
            try {
                var value = await redis.get(keys.latestWinner(room));

                if (!value) return null;
                
                try {
                    value = JSON.parse(value);
                } catch (err) {
                    logger.error(`themeStats::tournament::latestWinner::get(): Error parsing latestWinner value for room '${room}': ${err.message}`);
                    throw err;
                }

                return value;
            } catch (err) {
                logger.error(`themeStats::tournament::latestWinner::get(): Error getting latestWinner for room '${room}': ${err.message}`);
                throw err;
            }
        },
        put: async function(room, data) {
            return;
        },
		isPlayerStat: true
    };

    var currentWeekMostTournamentsWinner = {
        get: async function(room) {
            try {
                var value = await redis.get(keys.currentWeekMostTournamentsWinner(room));

                if (!value) return null;

                try {
                    value = JSON.parse(value);
                } catch (err) {
                    logger.error(`themeStats::tournament::currentWeekMostTournamentsWinner::get(): Error parsing currentWeekMostTournamentsWinner value for room '${room}': ${err.message}`);
                    throw err;
                }

                return value;
            } catch (err) {
                logger.error(`themeStats::tournament::currentWeekMostTournamentsWinner::get(): Error getting currentWeekMostTournamentsWinner for room '${room}': ${err.message}`);
                throw err;
            }
        },
        put: async function(room, data) {
            return;
        },
        isPlayerStat: true
    };

    var lastWeekMostTournamentsWinner = {
        get: async function(room) {
            try {
                var value = await redis.get(keys.lastWeekMostTournamentsWinner(room));

                if (!value) return null;

                try {
                    value = JSON.parse(value);
                } catch (err) {
                    logger.error(`themeStats::tournament::lastWeekMostTournamentsWinner::get(): Error parsing lastWeekMostTournamentsWinner value for room '${room}': ${err.message}`);
                    throw err;
                }

                return value;
            } catch (err) {
                logger.error(`themeStats::tournament::lastWeekMostTournamentsWinner::get(): Error getting lastWeekMostTournamentsWinner for room '${room}': ${err.message}`);
                throw err;
            }
        },
        put: async function(room, data) {
            return;
        },
        isPlayerStat: true
    };

    var weeklyScheduledTournamentWinner = {
        get: async function(room) {
            try {
                var value = await redis.get(keys.weeklyScheduledTournamentWinner(room));

                if (!value) return null;

                try {
                    value = JSON.parse(value);
                } catch (err) {
                    logger.error(`themeStats::tournament::weeklyScheduledTournamentWinner::get(): Error parsing weeklyScheduledTournamentWinner value for room '${room}': ${err.message}`);
                    throw err;
                }

                return value;
            } catch (err) {
                logger.error(`themeStats::tournament::weeklyScheduledTournamentWinner::get(): Error getting weeklyScheduledTournamentWinner for room '${room}': ${err.message}`);
                throw err;
            }
        },
        put: async function(room, data) {
            return;
        },
        isPlayerStat: true
    };

    async function preProcess(room, data) {
        var now = Date.now();

        var currentDate = new Date(now);

        var currentDayOfWeek = currentDate.getUTCDay();
        var hours = currentDate.getUTCHours(), 
			minutes = currentDate.getUTCMinutes(), 
			seconds = currentDate.getUTCSeconds(), 
			milliseconds = currentDate.getUTCMilliseconds()

		// time difference to 00:00am of the closest sunday in the past
		var timeDiff = (currentDayOfWeek*(24*60*60*1000) + hours*(60*60*1000) + minutes*(60*1000) + seconds*1000 + milliseconds)
		var oneWeek = 7 * 24*60*60*1000;

        try {
            [
				keys.currentWeekMostTournamentsWinner(room),
				keys.lastWeekMostTournamentsWinner(room),
				keys.weeklyScheduledTournamentWinner(room)
            ].forEach(async (key) => {
                await updatePlayerProfile(key, data.roomGameVersion);
            })
        } catch (err) {
            logger.error(`themeStats::boss::preProcess(): Error updating player profiles for room '${room}': ${err.message}`);
            throw err;
        }

        try {
            // compute last week most tournaments winner player if we're past the compute time
            var lastWeekPlayerComputeTime = await redis.get(keys.lastWeekPlayerComputeTime(room));

            if (lastWeekPlayerComputeTime) {
                try {
                    lastWeekPlayerComputeTime = parseInt(lastWeekPlayerComputeTime);
                } catch (err) {
                    throw err;
                }
            } else {
                lastWeekPlayerComputeTime = now - timeDiff + oneWeek;
            }

            var multi = redis.multi();
            var computingLastWeekPlayer = false;

            if (now >= lastWeekPlayerComputeTime) {
                computingLastWeekPlayer = true;
                multi.get(keys.currentWeekMostTournamentsWinner(room));
                multi.del(keys.tournamentWinnersCount(room));
                multi.del(keys.currentWeekMostTournamentsWinner(room));
                lastWeekPlayerComputeTime += oneWeek;
            }

            multi.set(keys.lastWeekPlayerComputeTime(room), lastWeekPlayerComputeTime);

            var replies = await multi.exec();

            if (computingLastWeekPlayer && replies[0]) {
                await redis.set(keys.lastWeekMostTournamentsWinner(room), replies[0]);
            }
        } catch (err) {
            logger.error(`themeStats::tournament::preProcess(): Error processing tournament stats for room '${room}': ${err.message}`);
            throw err;
        }

        var existingCurrentWeekWinner;
        var newCurrentWeekWinner;
        try {
            var multi = redis.multi();

            if (data.winner) {
                multi.zIncrBy(keys.tournamentWinnersCount(room), 1, data.winner);
            }

            multi.zRange(keys.tournamentWinnersCount(room), -1, -1);
            multi.get(keys.currentWeekMostTournamentsWinner(room));

            var replies = await multi.exec();

            existingCurrentWeekWinner = replies[data.winner ? 2 : 1];
            newCurrentWeekWinner = replies[data.winner ? 1 : 0][0];

            try {
                existingCurrentWeekWinner = JSON.parse(existingCurrentWeekWinner);
            } catch (err) {
                logger.error(`themeStats::tournament::preProcess(): Error parsing existingCurrentWeekWinner value for room '${room}': ${err.message}`);
                throw err;
            }
        } catch (err) {
            logger.error(`themeStats::tournament::preProcess(): Error getting current week most tournaments winner for room '${room}': ${err.message}`);
            throw err;
        }

        try {
            if (data.winner) {
                var playerInfo = await wdfSessions.getPlayerInfo({
                    room: room,
                    pids: [ data.winner ]
                });

                if (!playerInfo[0]) return existingCurrentWeekWinner;

                playerInfo[0].pid = data.winner;

                var multi = redis.multi();
                multi.set(keys.latestWinner(room), JSON.stringify(playerInfo[0]));

                // newCurrentWeekWinner will always be either existingCurrentWeekWinner.pid OR data.winner
				// because only a single zincrby operation is being done on the sorted set and the relative
				// order of the entries (lex sorted if same score) before the zincrby will stay the same
                if (!existingCurrentWeekWinner || (existingCurrentWeekWinner.pid !== newCurrentWeekWinner)) {
                    multi.set(keys.currentWeekMostTournamentsWinner(room), JSON.stringify(playerInfo[0]));

                    // the new current week winner, to not make another get redis call in the next step
                    existingCurrentWeekWinner = playerInfo[0];
                }

                await multi.exec();
            }
        } catch (err) {
            logger.error(`themeStats::tournament::preProcess(): Error updating current week most tournaments winner for room '${room}': ${err.message}`);
            throw err;
        }

        try {
            if (data.winner && data.tournamentType === "weekly" && existingCurrentWeekWinner) {
                await redis.set(keys.weeklyScheduledTournamentWinner(room), JSON.stringify(existingCurrentWeekWinner));
            }
        } catch (err) {
            logger.error(`themeStats::tournament::preProcess(): Error updating weekly scheduled tournament winner for room '${room}': ${err.message}`);
            throw err;
        }

        return;
    }

    return {
        preProcess: preProcess,
        stats: {
            totalStars,
            latestWinner,
            currentWeekMostTournamentsWinner,
            lastWeekMostTournamentsWinner,
            weeklyScheduledTournamentWinner
        }
    };
}());

var globalStats = (async function() {
    var keys = {
        "totalStars": function(room) { return "wdf:rooms:" + room + ":stats:global:stars-total" },
    };

    var totalStars = {
        get: async function(room) {
            try {
                var value = await redis.get(keys.totalStars(room));
                
                if (!value) return null;

                try {
                    value = parseInt(value);
                } catch (err) {
                    logger.error(`themeStats::global::totalStars::get(): Error parsing totalStars value for room '${room}': ${err.message}`);
                    throw err;
                }

                return value;
            } catch (err) {
                logger.error(`themeStats::global::totalStars::get(): Error getting totalStars for room '${room}': ${err.message}`);
                throw err;
            }
        },
        put: async function(room, data) {
            if (data.stars) {
                try {
                    await redis.incrBy(keys.totalStars(room), data.stars);
                } catch (err) {
                    logger.error(`themeStats::global::totalStars::put(): Error incrementing totalStars for room '${room}': ${err.message}`);
                    throw err;
                }
            }
            return;
        }
    };

    return {
        stats: {
            totalStars
        }
    }
}());


const init = async (clients) => {
    wdfSchedule = clients.wdfSchedule;
    wdfSessions = clients.wdfSessions;

    // Await all async IIFEs - they return promises that need to be resolved
    for (const theme of Object.keys(themeStats)) {
        themeStats[theme] = await themeStats[theme];
    }
    globalStats = await globalStats;

    Object.keys(themeStats).forEach(async (theme) => {
		var themeStatNames = Object.keys(themeStats[theme].stats);
		var globalStatNames = Object.keys(globalStats.stats);
			
		async function put(room, data, callback) {
            if (globalStats.hasOwnProperty("preProcess")) {
                await globalStats.preProcess(room, data);
            }

            globalStatNames.forEach(async (statName) => {
                await globalStats.stats[statName].put(room, data);
            });

            if (themeStats[theme].hasOwnProperty("preProcess")) {
                await themeStats[theme].preProcess(room, data);
            }

            themeStatNames.forEach(async (statName) => {
                await themeStats[theme].stats[statName].put(room, data);
            });
		}
			
		themeStats[theme].put = put

		if (!module.exports[theme]) module.exports[theme] = {}
		module.exports[theme].put = themeStats[theme].put
	})
    return;
};

// TODO:
const updatePlayerProfile = async (key, gameVersion) => {
    return;
};

const isValidStat = (statName) => { 
    var splitted = statName.split("-")

	// all stat names should be of the format "<themeType>-<statName>", hence the check against length 2
	if (splitted.length !== 2) return false

	var theme = splitted[0]
	var stat = splitted[1]

	return (theme === "global" && globalStats.stats.hasOwnProperty(stat)) || 
				(themeStats.hasOwnProperty(theme) && themeStats[theme].stats.hasOwnProperty(stat))
};

const isPlayerStat = (statName) => {
    var splitted = statName.split("-")
		var theme = splitted[0]
		var stat = splitted[1]

		return isValidStat(statName) && 
			(theme === "global" ? globalStats.stats[stat].isPlayerStat : themeStats[theme].stats[stat].isPlayerStat)
};

const get = (room, statName) => {
    if (!isValidStat(statName))
		return callback(null, null)

	var splitted = statName.split("-")
	var theme = splitted[0]
	var stat = splitted[1]

	if (theme === "global")
		return globalStats.stats[stat].get(room, callback)

	return themeStats[theme].stats[stat].get(room, callback)
};


module.exports = {
    init,
    get,
    isValidStat,
    isPlayerStat
};
