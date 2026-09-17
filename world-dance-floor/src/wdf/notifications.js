// External modules

// Internal modules
const logger = require("../lib/logger").createLogger({ service: "wdf/notifications" });
const oasis = require("../lib/oasis");
const redis = require("../lib/redis").client;

// WDF modules
var wdfSessions;
var wdfScoring;
var wdfRoomManager;

var startGenerateTime = 10;
var endBufferTime = 20;

var WDF_NOTIFICATION_COMPUTE_DURATION = 40;
var WDF_NOTIFICATION_SHOW_DURATION = 10;
var WDF_NOTIFICATIONS_RESET_TIMEDIFF = 10;

const notifications = {
    // -- Common -- (nextTheme)
    "nextTheme": {
        "type": "fixed",
        "constructNotification": async (room, state) => {
            try {
                const nextTheme = await wdfRoomManager.getNextThemeDetails(room);

                if (!nextTheme) {
                    return null;
                }

                var notification = {};

                notification.title = 12453;

                switch (nextTheme.type) {
                    case "vote":
                        notification.info = 12989;
                        break;
                    case "boss":
                        notification.info = 12985;
                        break;
                    case "spotlight":
                        notification.info = 12986;
                        break;
                    case "tournament":
                        notification.info = 12987;
                        break;
                    case "teambattle":
                        notification.info = 12988;
                        break;
                    case "map":
                        notification.info = 990001;
                        break;
                }

                const themeValue = nextTheme.type === "map" ? "spotlight" : nextTheme.type;

                notification.data = {
                    theme: {
                        value: themeValue
                    }
                }

                return notification;
            } catch (err) {
                logger.error(`Error constructing nextTheme notification for room ${room}: ${err.message}\n${err.stack}`);
                return null;
            }
        },
        "canShow": async (options) => {
            if (!options.room) return null;

            const room = options.room;

            try {
                const nextTheme = await wdfRoomManager.getNextThemeDetails(room);
                const now = Date.now() / 1000;

                var showTime = (options.state.currentTheme.ingameEndTime - (WDF_NOTIFICATION_COMPUTE_DURATION));
                var lastInGameScreen = options.state.currentTheme.lastInGameScreen;
                var timeCheck = now > showTime;
                var hasNextTheme = nextTheme !== null;
                
                //logger.debug(`nextTheme canShow: lastInGameScreen=${lastInGameScreen}, now=${now.toFixed(1)}, showTime=${showTime.toFixed(1)}, timeCheck=${timeCheck}, hasNextTheme=${hasNextTheme}`);
                
                var canShow = (lastInGameScreen && timeCheck && hasNextTheme);

                return canShow;
            } catch (err) {
                logger.error(`Error checking canShow for nextTheme notification for room ${room}: ${err.message}\n${err.stack}`);
                return false;
            }
        }
    },
    // -- Country -- 
    "country": {
        "priority": 2,
        "type": "reoccurring",
        "constructNotification": async (room, state) => {
			var countryCount = state.notificationsList.country.countryCount
			var country = state.notificationsList.country.countryToShow

			var notification = {};
            
			notification.title = 13478;
			notification.info = 13479;

			state.notificationsList.country.countryHistory.push(country);

			notification.data = {
				"COUNTRY": { value: country },
				"NB_PLAYERS": { value: countryCount[country].toString() }
			};

            return notification;
        },
        "canShow": async (options) => {
            if (!options.room || !options.state) return null;

            const room = options.room;

            var state = options.state;

            if (!state.notificationsList.country.countryHistory) {
                state.notificationsList.country.countryHistory = [];
            }

            try {
                var countryCount = await wdfSessions.getCountryCounts({
                    room: options.room
                });
                
                var countryList = Object.keys(countryCount).filter(c => {
                    return state.notificationsList.country.countryHistory.indexOf(c) === -1;
                });

                if (countryList.length === 0) {
                    return false;
                }

                //logger.debug("countryList", countryList);
                //logger.debug("countryHistory", state.notificationsList.country.countryHistory);

                var country = countryList[Math.round(Math.random() * (countryList.length - 1))];

                state.notificationsList.country.countryCount = countryCount;
                state.notificationsList.country.countryToShow = country;

                return true;
            } catch (err) {
                logger.error(`Error fetching country counts for room ${room}: ${err.message}\n${err.stack}`);
                return false;
            }
        }
    },
    // Boss
    "boss-startBattle": {
        "type": "fixed",
        "constructNotification": async (room, state) => {
            var notification = {};
            notification.title = 13593;
            return notification;
        }
    },
    "boss-trailingCommunity": {
        "type": "fixed",
        "constructNotification": async (room, state) => {
            var notification = {};
            notification.title = 13058;
            return notification;
        }
    },
    "boss-leadingCommunity": {
        "type": "fixed",
        "constructNotification": async (room, state) => {
            var notification = {};
            notification.title = 13056;
            return notification;
        }
    },
    "boss-onPointCommunity": {
        "type": "fixed",
        "constructNotification": async (room, state) => {
            var notification = {};
            notification.title = 13059;
            return notification;
        }
    },
    "boss-numberOfPlayers": {
        "type": "fixed",
        "constructNotification": async (room, state) => {
            var notification = {};
            
            try {
                const playerScores = await wdfScoring["boss"].getPlayerScores({
                    room: room,
                });

                notification.title = 13478;
                notification.info = 13483;
                notification.data = {
                    "NB_PLAYERS": { value: playerScores.length.toString() }
                };

                return notification;
            } catch (err) {
                logger.error(`Error constructing boss-numberOfPlayers notification for room ${room}: ${err.message}\n${err.stack}`);
                return null;
            }
        }
    },
    "boss-communityLeader": {
        "priority": 1,
        "type": "reoccurring",
        "constructNotification": async (room, state) => {
            var notification = {};

            notification.title = 13480;
            notification.info = 13481;

            try {
                var playerScores = await wdfScoring["boss"].getPlayerScores({
                    room: room,
                });

                var leader = playerScores[0];

                var dancerCardInfo = await wdfSessions.getPlayerInfo({
                    room: room,
                    pids: leader ? [leader.pid] : []
                });

                notification.data = {};

                if (dancerCardInfo[0]) {
                    notification.data.PLAYER_ID = { value: dancerCardInfo[0].name }
					notification.data.nameSuffix = { value: dancerCardInfo[0].nameSuffix.toString() }
					notification.data.country = { value: dancerCardInfo[0].country.toString() }
					notification.data.avatar = { value: dancerCardInfo[0].avatar.toString() }
                }

                return notification;
            } catch (err) {
                logger.error(`Error constructing boss-communityLeader notification for room ${room}: ${err.message}\n${err.stack}`);
                return null;
            }
        },
        "canShow": async (options) => {
            return (!options.state.firstNotificationGenerated);
        }
    },
    // Spotlight
    "spotlight-reward": {
		"priority": 1,
		"type": "reoccurring",
		"constructNotification": function(room, state) {
			var notification = {};
			notification.title = 13487
			notification.info = 13531;
			notification.data = { "REWARD": { value: state.currentTheme.themeData.reward.toString()} }
			return notification;
		}
	},
    // Map + Vote
    "map-leader": {
        "priority": 1,
        "type": "reoccurring",
        "constructNotification": async (room, state) => {
            var notification = {};

            notification.title = 13480;
            notification.info = 13490;

            try {
                var playerScores = await wdfScoring["map"].getPlayerScores({
                    room: room,
                });

                var leader = playerScores[0];

                var dancerCardInfo = await wdfSessions.getPlayerInfo({
                    room: room,
                    pids: leader ? [leader.pid] : []
                });

                notification.data = {};

                if (dancerCardInfo[0]) {
                    notification.data.PLAYER_ID = { value: dancerCardInfo[0].name }
                    notification.data.nameSuffix = { value: dancerCardInfo[0].nameSuffix.toString() }
                    notification.data.country = { value: dancerCardInfo[0].country.toString() }
                    notification.data.avatar = { value: dancerCardInfo[0].avatar.toString() }
                }

                return notification;
            } catch (err) {
                logger.error(`Error constructing map-leader notification for room ${room}: ${err.message}\n${err.stack}`);
                return null;
            }
        }
    },
    "map-numberofPlayers": {
        "priority": 1,
        "type": "reoccurring",
        "constructNotification": async (room, state) => {
            var notification = {};
            try {
                const playerScores = await wdfScoring["map"].getPlayerScores({
                    room: room,
                });

                notification.title = 13482;
                notification.info = 13491;
                notification.data = {
                    "NB_PLAYERS": { value: playerScores.length.toString() }
                };

                return notification;
            } catch (err) {
                logger.error(`Error constructing map-numberofPlayers notification for room ${room}: ${err.message}\n${err.stack}`);
                return null;
            }
        },
        "canShow": async (options) => {
            return (options.gameVersion === "jd2017");
        }
    },
    "map-numberOfStars": {
        "priority": 1,
        "type": "reoccurring",
        "constructNotification": async (room, state) => {
            var notification = {};
            notification.title = 13492;
            notification.info = 13494;
            notification.data = {
                "NB_STARS": {
                    value: state.notificationsList["map-numberOfStars"].stars.toString()
                }
            }
            return notification;
        },
        "canShow": async (options) => {
            if (!options.room || !options.state) return null;

            const room = options.room;

            //logger.debug("state", options.state);
            //logger.debug("firstNotificationGenerated", options.state.firstNotificationGenerated);

            if (!options.state.firstNotificationGenerated) {
                return false;
            }

            try {
                var scores = await wdfScoring["map"].getPlayerScores({
                    room: room,
                });

                //logger.debug("scores",scores);

                var stars = 0;

                scores.forEach(entry => {
                    stars += Math.floor((entry.score * 13333)/2000);
                });

                //logger.debug("stars", stars);

                if (stars > 0) {
                    options.state.notificationsList["map-numberOfStars"].stars = stars;
                    return true;
                }

                return false;
            } catch (err) {
                logger.error(`Error constructing map-numberOfStars notification for room ${room}: ${err.message}\n${err.stack}`);
                return false;
            }
        }
    },
    "map-localRank": {
        "priority": 1,
        "type": "reoccurring",
        "constructNotification": async (room, state) => {
            var notification = {};

            try {
                var numberOfPlayers = await wdfSessions.getNumberOfPlayers({
                    room: room
                });

                notification.title = 13495;
                notification.data = {
                    "NB_PLAYERS": { value: numberOfPlayers.toString() }
                };

                return notification;
            } catch (err) {
                logger.error(`Error constructing map-localRank notification for room ${room}: ${err.message}\n${err.stack}`);
                return null;
            }
        }
    },
    // Team Battle
    "team-leader": {
        "priority": 1,
        "type": "reoccurring",
        "constructNotification": async (room, state) => {
            var notification = {};
            notification.title = 13480;
            notification.info = 13508;

            var leader = state.notificationsList["team-leader"].leader;
            var team = state.currentTheme.themeData.teams[state.notificationsList["team-leader"].teamIndex];

            try {
                var dancerCardInfo = await wdfSessions.getPlayerInfo({
                    room: room,
                    pids: leader ? [leader.pid] : []
                });

                notification.data = {
                    "PLAYER_ID": { value: dancerCardInfo[0] ? dancerCardInfo[0].name : "" },
					nameSuffix: { value: dancerCardInfo[0] ? dancerCardInfo[0].nameSuffix.toString() : "" },
					country: { value: dancerCardInfo[0] ? dancerCardInfo[0].country.toString() : "" },
					avatar: { value: dancerCardInfo[0] ? dancerCardInfo[0].avatar.toString() : "" },
					"TEAM": { value: team }
                };

                return notification;
            } catch (err) {
                logger.error(`Error constructing team-leader notification for room ${room}: ${err.message}\n${err.stack}`);
                return null;
            }
        },
        "canShow": async (options) => {
            var teamIndex = ((options.state.notificationsList["team-leader"].lastTeamIndex || 0) + 1) % options.state.currentTheme.themeData.teams.length;
			options.state.notificationsList["team-leader"].lastTeamIndex = teamIndex;
            
            try {
                var teamScores = await wdfScoring["teambattle"].getTeamScores({
                    room: options.room,
                    team: options.state.currentTheme.themeData.teams[teamIndex]
                });

                if (teamScores.length > 0) {
                    options.state.notificationsList["team-leader"].leader = teamScores[0];
                    options.state.notificationsList["team-leader"].teamIndex = teamIndex;
                    return true;
                }

                return false;
            } catch (err) {
                logger.error(`Error checking canShow for team-leader notification for room ${options.room}: ${err.message}\n${err.stack}`);
                return false;
            }
        }
    },
    "team-numberOfStarsTotal": {
        "priority": 1,
        "type": "reoccurring",
        "constructNotification": async (room, state) => {
            var notification = {};
            notification.title = 13492;
            notification.info = 14286;
            notification.data = {
                "NB_STARS": {
                    value: state.notificationsList["team-numberOfStarsTotal"].stars.toString()
                }
            }
            return notification;
        },
        "canShow": async (options) => {
            var stars = 0;

            try {
                options.state.currentTheme.themeData.teams.forEach(async (team) => {
                    var scores = await wdfScoring["teambattle"].getTeamScores({
                        room: options.room,
                        team: team
                    });
                    
                    scores.forEach(entry => {
                        stars += Math.floor((entry.score * 13333)/2000);
                    });
                });
            } catch (err) {
                logger.error(`Error constructing team-numberOfStarsTotal notification for room ${options.room}: ${err.message}\n${err.stack}`);
                return false;
            }

            if (stars > 0) {
                options.state.notificationsList["team-numberOfStarsTotal"].stars = stars;
                return true;
            }

            return false;
        }
    },
    "team-leadingTeam": {
        "priority": 1,
        "type": "reoccurring",
        "constructNotification": async (room, state) => {
            var notification = {};
            notification.title = 14284;
            notification.info = 14285;

            return notification;
        }
    },
    "team-numberOfStars": {
        "priority": 1,
        "type": "reoccurring",
        "constructNotification": async (room, state) => {
            var notification = {};
            notification.title = 13492;
            notification.info = 14509;
            notification.data = {
                "NB_STARS": {
                    value: state.notificationsList["team-numberOfStars"].stars.toString()
                },
                "TEAM": {
                    value: state.currentTheme.themeData.teams[state.notificationsList["team-numberOfStars"].teamIndex].toString()
                }
            }
            return notification;
        },
        "canShow": async (options) => {
            var teamIndex = ((options.state.notificationsList["team-leader"].lastTeamIndex || 0) + 1) % options.state.currentTheme.themeData.teams.length;

            options.state.notificationsList["team-numberOfStars"].lastTeamIndex = teamIndex;

            try {
                var teamScores = await wdfScoring["teambattle"].getTeamScores({
                    room: options.room,
                    team: options.state.currentTheme.themeData.teams[teamIndex]
                });

                var stars = 0;

                teamScores.forEach(entry => {
                    stars += Math.floor((entry.score * 13333)/2000);
                });

                if (stars > 0) {
                    options.state.notificationsList["team-numberOfStars"].stars = stars;
                    options.state.notificationsList["team-numberOfStars"].teamIndex = teamIndex;
                    return true;
                }

                return false;
            } catch (err) {
                logger.error(`Error constructing team-numberOfStars notification for room ${options.room}: ${err.message}\n${err.stack}`);
                return false;
            }
        }
    },
    "team-numberOfPlayers": {
        "priority": 1,
        "type": "reoccurring",
        "constructNotification": async (room, state) => {
            var notification = {};
            try {
                const numberOfPlayers = await wdfSessions.getNumberOfPlayers({
                    room: room,
                });

                notification.title = 13482;
                notification.info = 13491;
                notification.data = {
                    "NB_PLAYERS": { value: numberOfPlayers.toString() }
                };

                return notification;
            } catch (err) {
                logger.error(`Error constructing team-numberOfPlayers notification for room ${room}: ${err.message}\n${err.stack}`);
                return false;
            }
        }
    },
    // Tournament
    "tournament-leaderOfCompetition": {
        "priority": 1,
        "type": "reoccurring",
        "constructNotification": async (room, state) => {
            var notification = {};
            notification.title = 13480;
            notification.info = 13489;

            var leader;
            try {
                if (state.currentTheme.themeData.roundNumber > 1) {
                    var tournamentScores = await wdfScoring["tournament"].getTournamentScores({
                        room: room,
                    });

                    leader = tournamentScores[0];
                } else {
                    var playerScores = await wdfScoring["tournament"].getPlayerScores({
                        room: room,
                    });

                    leader = playerScores[0];
                }

                var dancerCardInfo = await wdfSessions.getPlayerInfo({
                    room: room,
                    pids: leader ? [leader.pid] : []
                });

                notification.data = {};

                if (dancerCardInfo[0]) {
                    notification.data.PLAYER_ID = { value: dancerCardInfo[0].name }
                    notification.data.nameSuffix = { value: dancerCardInfo[0].nameSuffix.toString() }
                    notification.data.country = { value: dancerCardInfo[0].country.toString() }
                    notification.data.avatar = { value: dancerCardInfo[0].avatar.toString() }
                }

                return notification;
            } catch (err) {
                logger.error(`Error constructing tournament-leaderOfCompetition notification for room ${room}: ${err.message}\n${err.stack}`);
                return false;
            }
        }
    },
    "tournament-leaderOfTrack": {
        "priority": 1,
        "type": "reoccurring",
        "constructNotification": async (room, state) => {
            var notification = {};
            notification.title = 13480;
            notification.info = 13490;

            try {
                var playerScores = await wdfScoring["tournament"].getPlayerScores({
                    room: room,
                });

                var leader = playerScores[0];

                var dancerCardInfo = await wdfSessions.getPlayerInfo({
                    room: room,
                    pids: leader ? [leader.pid] : []
                });

                notification.data = {};

                if (dancerCardInfo[0]) {
                    notification.data.PLAYER_ID = { value: dancerCardInfo[0].name }
                    notification.data.nameSuffix = { value: dancerCardInfo[0].nameSuffix.toString() }
                    notification.data.country = { value: dancerCardInfo[0].country.toString() }
                    notification.data.avatar = { value: dancerCardInfo[0].avatar.toString() }
                }

                return notification;
            } catch (err) {
                logger.error(`Error constructing tournament-leaderOfTrack notification for room ${room}: ${err.message}\n${err.stack}`);
                return null;
            }
        }
    },
    "tournament-reward": {
        "priority": 1,
        "type": "reoccurring",
        "constructNotification": async (room, state) => {
            var notification = {};

            switch (state.currentTheme.themeData.tournamentType) {
                case "ESWC":
                    notification.title = 13630;
                    break;
                case "weekly":
                    notification.title = 13662;
                    break;
                case "happy-hour":
                case "default":
                    notification.title = 13487;
                    notification.data = {
                        "REWARD": { value: 700 }
                    };
                    break;
            }

            notification.info = 13488;

            return notification;
        },
        "canShow": async (options) => {
            return (options.gameVersion === "jd2017");
        }
    },
    "tournament-numberOfPlayers": {
        "priority": 1,
        "type": "reoccurring",
        "constructNotification": async (room, state) => {
            var notification = {};
            try {
                const playerScores = await wdfScoring["tournament"].getPlayerScores({
                    room: room,
                });
                notification.title = 13482;
                notification.info = 13491;
                notification.data = {
                    "NB_PLAYERS": { value: playerScores.length.toString() }
                };
                return notification;
            } catch (err) {
                logger.error(`Error constructing tournament-numberOfPlayers notification for room ${room}: ${err.message}\n${err.stack}`);
                return null;
            }
        },
        "canShow": async (options) => {
            return (options.gameVersion === "jd2017");
        }
    },
    "tournament-numberOfStarsTrack": {
        "priority": 1,
        "type": "reoccurring",
        "constructNotification": async (room, state) => {
            var notification = {};
            notification.title = 13492;
            notification.info = 13494;
            notification.data = {
                "NB_STARS": {
                    value: state.notificationsList["tournament-numberOfStarsTrack"].stars.toString()
                }
            }
            return notification;
        },
        // cant be first notif. and star value cant be 0
        "canShow": async (options) => {
            try {
                var playerScores = await wdfScoring["tournament"].getPlayerScores({
                    room: options.room,
                });

                if (!options.state.firstNotificationGenerated) {
                    return false;
                }

                var stars = 0;

                playerScores.forEach(entry => {
                    stars += Math.floor((entry.score * 13333)/2000);
                });

                if (stars > 0) {
                    options.state.notificationsList["tournament-numberOfStarsTrack"].stars = stars;
                    return true;
                }

                return false;
            } catch (err) {
                logger.error(`Error constructing tournament-numberOfStarsTrack notification for room ${options.room}: ${err.message}\n${err.stack}`);
                return false;
            }
        }
    },
    "tournament-numberOfStarsCompetition": {
        "priority": 1,
        "type": "reoccurring",
        "constructNotification": async (room, state) => {
            var notification = {};
            notification.title = 13492;
            notification.info = 13493;
            notification.data = {
                "NB_STARS": {
                    value: state.notificationsList["tournament-numberOfStarsCompetition"].stars.toString()
                }
            }
            return notification;
        },
        "canShow": async (options) => {
            if (!options.state.firstNotificationGenerated) {
                return false;
            }

            try {
                var tournamentScores = await wdfScoring["tournament"].getTournamentScores({
                    room: options.room,
                });

                var stars = 0;

                tournamentScores.forEach(entry => {
                    stars += Math.floor((entry.score * 13333)/2000);
                });

                if (stars > 0) {
                    options.state.notificationsList["tournament-numberOfStarsCompetition"].stars = stars;
                    return true;
                }

                return false;
            } catch (err) {
                logger.error(`Error constructing tournament-numberOfStarsCompetition notification for room ${options.room}: ${err.message}\n${err.stack}`);
                return false;
            }
        }
    },
    "tournament-localRank": {
        "priority": 1,
        "type": "reoccurring",
        "constructNotification": async (room, state) => {
            var notification = {};

            try {
                var numberOfPlayers = await wdfSessions.getNumberOfPlayers({
                    room: room
                });

                notification.title = 13495;
                notification.data = {
                    "NB_PLAYERS": { value: numberOfPlayers.toString() }
                };

                return notification;
            } catch (err) {
                logger.error(`Error constructing tournament-localRank notification for room ${room}: ${err.message}\n${err.stack}`);
                return null;
            }
        }
    }
};

var reoccurringNotifications = {
    "common": [ "country", "nextTheme" ],
    "boss": [ "boss-numberOfPlayers", "boss-communityLeader" ],
    "spotlight": [ "spotlight-reward" ],
    "map": [ "map-leader", "map-numberofPlayers", "map-numberOfStars" ],
    "vote": [ "map-leader", "map-numberofPlayers", "map-numberOfStars" ],
    "teambattle": [ "team-numberOfPlayers", "team-numberOfStars", "team-numberOfStarsTotal", "team-leader", "team-leadingTeam" ],
    "tournament": [ "tournament-numberOfStarsCompetition", "tournament-reward", "tournament-numberOfStarsTrack", "tournament-numberOfPlayers", "tournament-leaderOfCompetition" ]
};

var keys = {
    state: (room) => { return `wdf:rooms:${room}:notificationState`; },
    notification: (room) => { return `wdf:rooms:${room}:notification`; },
};

const getState = async (room) => {
    try {
        var reply = await redis.get(keys.state(room));

        var state;
        try {
            state = JSON.parse(reply);
        } catch (err) {
            throw err;
        }

        if (!state) {
            state = {};
        }

        return state;
    } catch (err) {
        logger.error(`Error fetching notifications state for room ${room}: ${err.message}\n${err.stack}`);
        return {};
    }
};

const setState = async (options) => {
    try {
        await redis.set(keys.state(options.room), JSON.stringify(options.state));
    } catch (err) {
        logger.error(`Error setting notifications state for room ${options.room}: ${err.message}\n${err.stack}`);
    }
};

const constructReoccurringList = async (theme) => {
    var reoccurringNotificationsList = {};
    var themeNotifications = reoccurringNotifications[theme] || [];
    if (!reoccurringNotifications[theme]) {
        logger.warn(`Theme '${theme}' not found in reoccurringNotifications, using only common notifications`);
    }
    var tempNotificationList = themeNotifications.concat(reoccurringNotifications["common"]);

    tempNotificationList.forEach(entry => {
        reoccurringNotificationsList[entry] = {
            priority: notifications[entry].priority,
            type: notifications[entry].type,
            showCount: 0
        };
    });

    return reoccurringNotificationsList;
};

const pushNotifications = async (options) => {
    var tempNotificationList = {};

    try {
        for (var index in options.notifications) {
            if (!notifications[options.notifications[index]]) {
                throw new Error(`Notification ${options.notifications[index]} does not exist!`);
            }

            var notification = options.notifications[index];

            tempNotificationList[notification] = {
                priority: notifications[notification].priority,
                type: notifications[notification].type,
                showCount: 0
            };
        };

        var state = await getState(options.room);

        state.notificationsList = {
            ...state.notificationsList,
            ...tempNotificationList
        };

        await setState({
            room: options.room,
            state: state
        });
    } catch (err) {
        logger.error(`Error pushing notifications for room ${options.room}: ${err.message}\n${err.stack}`);
        return;
    }
};

const queueReset = async (options) => {
    try {
        var state = await getState(options.room);

        if (!state.queuedThemes) state.queuedThemes = [];

        function checkOptions() {
            if (options.theme === "spotlight" && (!options.themeData || !options.themeData.reward)) {
                logger.error(`Spotlight theme reset requires themeData with reward property!`);
                return false;
            }

            if (options.theme === "teambattle" && (!options.themeData || !options.themeData.teams || !Array.isArray(options.themeData.teams))) {
                logger.error(`Team Battle theme reset requires themeData with teams array property!`);
                return false;
            }

            if (options.theme === "tournament" && (!options.gameVersion)) {
                logger.error(`Tournament theme reset requires gameVersion property!`);
                return false;
            }

            return true;
        }

        if (!checkOptions()) return;

        state.queuedThemes.push({
            ingameStartTime : options.ingameStartTime,
			ingameEndTime: options.ingameEndTime,
			resetTime: options.ingameStartTime - WDF_NOTIFICATIONS_RESET_TIMEDIFF,
			theme : options.theme,
			themeData: options.themeData || {},
			lastInGameScreen: options.lastInGameScreen || false,
			gameVersion: options.gameVersion
        });

        await setState({
            room: options.room,
            state: state
        });
    } catch (err) {
        logger.error(`Error queueing notifications reset for room ${options.room}: ${err.message}\n${err.stack}`);
        return;
    }
};

const clear = async (room) => {
    try {
        await redis.del(keys.notification(room));
    } catch (err) {
        logger.error(`Error clearing notification for room ${room}: ${err.message}\n${err.stack}`);
    }
};

const selectNotification = async (options) => {
    var notificationsList = options.state.notificationsList;
    var lastNotification = options.state.lastNotification;
    var fixedNotificationList = [];
    var eligibleKeys = [];

    //logger.debug(`selectNotification: notificationsList keys: ${JSON.stringify(Object.keys(notificationsList || {}))}`);

    if (!notificationsList || Object.keys(notificationsList).length === 0) {
        logger.warn(`selectNotification: notificationsList is empty or undefined`);
        return null;
    }

    // Build a list of eligible notifications instead of deleting from original
    await Promise.all(Object.keys(notificationsList).map(async (key) => {
        var isFixed = (notificationsList[key].type === "fixed");

        // Skip if this was the last notification shown
        if (key === lastNotification) {
            return;
        }

        // Check the notifications definition object for canShow, not the state
        if (notifications[key] && notifications[key].canShow) {
            try {
                const show = await notifications[key].canShow(options);
                //logger.debug(`selectNotification: canShow for ${key} returned ${show}`);
                if (show) {
                    eligibleKeys.push(key);
                    if (isFixed) fixedNotificationList.push(key);
                }
            } catch (err) {
                logger.error(`selectNotification: canShow error for ${key}: ${err.message}`);
            }
        } else {
            // No canShow means always eligible
            eligibleKeys.push(key);
            if (isFixed) fixedNotificationList.push(key);
        }
    }));

    //logger.debug(`selectNotification: eligible keys: ${JSON.stringify(eligibleKeys)}, fixedNotificationList: ${JSON.stringify(fixedNotificationList)}`);

    if (fixedNotificationList.length > 0) {
        return fixedNotificationList[Math.round(Math.random() * (fixedNotificationList.length-1))];
    }

    // Filter out fixed type from eligible (they were handled above)
    var reoccurringKeys = eligibleKeys.filter(key => notificationsList[key].type !== "fixed");

    if (reoccurringKeys.length === 0) {
        return null; // no notifications there to show right now
    }

    //get the lowest show count notification
    var lowestShowCount = notificationsList[reoccurringKeys.reduce(function(prev, curr) {
		return (notificationsList[prev].showCount < notificationsList[curr].showCount) ? prev : curr;
	})].showCount;

    //filter all the notifications of the lowest showcount
    var showCountList = reoccurringKeys.filter(function(key) {
		return (notificationsList[key].showCount === lowestShowCount) && (key !== lastNotification);
	});

    if (showCountList.length === 0) {
        return null;
    }

    //get the highest priority
	var priority = notificationsList[showCountList.reduce(function(prev, curr) {
		return  (notificationsList[prev].priority < notificationsList[curr].priority) ? prev : curr;
	})].priority;

	//filter all the notifications with highest priority
    var priorityList = showCountList.filter(function(index) {
		return (notificationsList[index].priority === priority);
	});

	//finally select the notification randomly from the priority list
	var selectedNotification = priorityList[Math.round(Math.random() * (priorityList.length-1))];
	
    return selectedNotification;
};

const update = async (room, gameVersion) => {
    try {
        var state = await getState(room);

        if (!state.gameVersion) {
            state.gameVersion = gameVersion;
        }

        var now = (Date.now() / 1000);

        if (state.queuedThemes && state.queuedThemes[0] && now > state.queuedThemes[0].resetTime) {
            // Check if we're already on this theme (prevent duplicate resets)
            if (state.currentTheme && 
                state.currentTheme.ingameStartTime === state.queuedThemes[0].ingameStartTime &&
                state.currentTheme.theme === state.queuedThemes[0].theme) {
                // Already processing this theme, just remove from queue
                state.queuedThemes.shift();
                await setState({ room: room, state: state });
            } else {
                await clear(room);

                state.currentTheme = state.queuedThemes[0];
                state.queuedThemes.shift();

                state.notificationsList = await constructReoccurringList(state.currentTheme.theme);
                state.nextNotificationComputeTime = state.currentTheme.ingameStartTime + startGenerateTime;
                state.penultimateNotificationGenerated = false;
                state.firstNotificationGenerated = false;

                logger.info(`[${room}] Notifications reset for theme ${state.currentTheme.theme}, next compute at ${state.nextNotificationComputeTime}`);

                await setState({
                    room: room,
                    state: state
                });
            }
        }

        if (!state.currentTheme) {
            return;
        }
        
        // Before in-game starts - nothing to do
        if (now < state.currentTheme.ingameStartTime + startGenerateTime) {
            return;
        }
        
        // After in-game ends - clear notification or set call time to prevent stale data
        if (now > state.currentTheme.ingameEndTime) {
            try {
                var storedNotif = await redis.get(keys.notification(room));
                if (storedNotif) {
                    storedNotif = JSON.parse(storedNotif);
                    // Set call time far in the future so client doesn't spam
                    if (storedNotif.nextNotificationCallTime < now + 60) {
                        storedNotif.nextNotificationCallTime = now + 300; // 5 minutes
                        await redis.set(keys.notification(room), JSON.stringify(storedNotif));
                    }
                }
            } catch (err) {
                // Ignore
            }
            return;
        }

        if (now < state.nextNotificationComputeTime) {
            // Not time to compute yet, but update the stored notification's call time
            // so the client knows when to call back
            try {
                var storedNotif = await redis.get(keys.notification(room));
                if (storedNotif) {
                    storedNotif = JSON.parse(storedNotif);
                    if (storedNotif.nextNotificationCallTime < state.nextNotificationComputeTime) {
                        storedNotif.nextNotificationCallTime = state.nextNotificationComputeTime + WDF_NOTIFICATION_SHOW_DURATION;
                        await redis.set(keys.notification(room), JSON.stringify(storedNotif));
                    }
                }
            } catch (err) {
                // Ignore errors updating call time
            }
            return;
        }

        logger.info(`[${room}] Computing notification, now=${now}, nextComputeTime=${state.nextNotificationComputeTime}`);

        try {
            var selectedNotification = await selectNotification({
                room: room,
                state: state,
                gameVersion: state.gameVersion
            });

            if (!selectedNotification) {
                // Still update the compute time to prevent spamming
                state.nextNotificationComputeTime = now + WDF_NOTIFICATION_COMPUTE_DURATION;
                
                // Clear the old notification and set an empty one with updated call time
                var emptyNotification = {
                    nextNotificationCallTime: state.nextNotificationComputeTime + WDF_NOTIFICATION_SHOW_DURATION,
                    duration: WDF_NOTIFICATION_SHOW_DURATION
                };
                await redis.set(keys.notification(room), JSON.stringify(emptyNotification));
                
                await setState({
                    room: room,
                    state: state
                });
                return null;
            }

            if (notifications[selectedNotification].type === "fixed") {
                delete state.notificationsList[selectedNotification];
            } else {
                state.notificationsList[selectedNotification].showCount = ++state.notificationsList[selectedNotification].showCount || 1;
            }

            // construct the selected notification
            var constructedNotification = await notifications[selectedNotification].constructNotification(room, state);

            if (constructedNotification) {
                constructedNotification.name = state.lastNotification = selectedNotification;

                switch (constructedNotification.name) {
                    case "tournament-numberOfPlayers":
                    case "map-numberofPlayers":
                    case "boss-numberOfPlayers":
                        constructedNotification.name = "team-numberOfPlayers";
                        break;
                }
            } else {
                // constructNotification returned null - update timing to prevent spam
                state.lastNotification = selectedNotification;
                state.nextNotificationComputeTime = now + WDF_NOTIFICATION_COMPUTE_DURATION;
                
                var emptyNotification = {
                    nextNotificationCallTime: state.nextNotificationComputeTime + WDF_NOTIFICATION_SHOW_DURATION,
                    duration: WDF_NOTIFICATION_SHOW_DURATION
                };
                await redis.set(keys.notification(room), JSON.stringify(emptyNotification));
                
                await setState({
                    room: room,
                    state: state
                });
                logger.warn(`[${room}] constructNotification returned null for ${selectedNotification}, updated timing`);
                return;
            }

            if (!state.firstNotificationGenerated) {
                state.firstNotificationGenerated = true;
                state.nextNotificationComputeTime = now + WDF_NOTIFICATION_COMPUTE_DURATION;
                //call for the notification 10 seconds after we compute
				constructedNotification.nextNotificationCallTime = state.nextNotificationComputeTime + 10;
            }

            // if we are within the last 2 cycles seconds of notification generation this is the penultimate notification of the round.
            else if((now > (state.currentTheme.ingameEndTime - (WDF_NOTIFICATION_COMPUTE_DURATION * 2))) && !state.penultimateNotificationGenerated ) {
				//Set the compute time of the next notif within the compute time needed for the end of the map
				state.nextNotificationComputeTime = state.currentTheme.ingameEndTime - WDF_NOTIFICATION_COMPUTE_DURATION;
				
                //Show the last notifcation 20 seconds before the inGameEnd time
				constructedNotification.nextNotificationCallTime = state.currentTheme.ingameEndTime - endBufferTime;
				state.penultimateNotificationGenerated = true;
			} else {
				state.nextNotificationComputeTime = now + WDF_NOTIFICATION_COMPUTE_DURATION;
				//call for the notification 10 seconds after we compute
				constructedNotification.nextNotificationCallTime = state.nextNotificationComputeTime + 10;
			}
            
            // Cap nextNotificationCallTime to not exceed theme end time
            if (constructedNotification.nextNotificationCallTime > state.currentTheme.ingameEndTime) {
                constructedNotification.nextNotificationCallTime = state.currentTheme.ingameEndTime;
            }
            
            // Also cap nextNotificationComputeTime so we don't skip computing
            if (state.nextNotificationComputeTime > state.currentTheme.ingameEndTime) {
                state.nextNotificationComputeTime = state.currentTheme.ingameEndTime;
            }
					
            constructedNotification.duration = WDF_NOTIFICATION_SHOW_DURATION;
			
            if(constructedNotification.data) {
				Object.keys(constructedNotification.data).forEach(function(key) {
					constructedNotification.data[key].__class = "NotificationValue";
				});
			}

            await redis.set(keys.notification(room), JSON.stringify(constructedNotification));
            
            await setState({
                room: room,
                state: state
            });

            return;
        } catch (err) {
            await setState({
                room: room,
                state: state
            });
            throw err;
        }
    } catch (err) {
        logger.error(`Error updating notifications for room ${room}: ${err.message}\n${err.stack}`);
        return;
    }
};

const getNotification = async (options) => {
    try {
        var value = await redis.get(keys.notification(options.room));

        try {
            value = JSON.parse(value);
        } catch (err) {
            throw err;
        }

        var notification = {
            "__class": "Notification",
            ...value
        }

        if (notification.title) notification.title = oasis.getLocalization(notification.title, options.language);
        if (notification.info) notification.info = oasis.getLocalization(notification.info, options.language);

        return notification;
    } catch (err) {
        logger.error(`Error fetching notification for room ${options.room}: ${err.message}\n${err.stack}`);
        return null;
    }
};

const init = (clients) => {
    wdfSessions = clients.wdfSessions;
    wdfScoring = clients.wdfScoring;
    wdfRoomManager = clients.wdfRoomManager;

    return;
};


module.exports = {
    init,
    queueReset,
    update,
    pushNotifications,
    getNotification
};