// External modules

// Internal modules
const cache = require("../../lib/cache");
const logger = require("../../lib/logger").createLogger({ service: "wdf/scoring/teambattle" });
const redis = require("../../lib/redis").client;

// WDF modules
const wdfConfig = cache.file("/data/config.json").config;
var wdfSessions;
var wdfLeaderboard;
var wdfStats;

var keys = {
	playerScores: function (room, team) { return "wdf:rooms:"+ room +":player-scores:" + team; },
	lastStarInfo: function(room, team) { return "wdf:rooms:"+ room  + ":teambattle:last-star-info:" + team;},
	teamScores: function (room) { return "wdf:rooms:" + room + ":teambattle:theme-score"; },
	lastStar: function (room, team) { return "wdf:rooms:" + room + ":teambattle:last-star:"  + team; },
	firstStar: function(room) { return "wdf:rooms:" + room + ":teambattle:first-star"; },
	longestStreak: function(room) { return "wdf:rooms:" + room + ":teambattle:perfect-streaks"},
	recap: function(room) { return "wdf:rooms:" + room + ":score-recap" },
	recapComputed: function(room) { return "wdf:rooms:" + room + ":recap-computed" }
};


const init = (clients) => {
    wdfSessions = clients.wdfSessions;
    wdfLeaderboard = clients.wdfLeaderboard;
    wdfStats = clients.wdfStats;

    return;
};

const calculateStars = (score) => {
    var sixthStarValue = 5.5;
	var seventhStarValue = 6;
		
	var stars = 0;
	var playerStars = (score * 13333) / 2000;

	if (playerStars > sixthStarValue && playerStars < seventhStarValue) {
		stars = 6;
	} else if (playerStars > seventhStarValue) {
		stars = 7;
	} else {
		stars = playerStars;
	}

	return Math.floor(stars);
};

// To get the player team from pid
// Pass in the teams in the options if it is available in order to extra redis calls.
const getPlayerScoringInfo = async (options) => {
    var teams;

    // if we dont have the team names get the team names
    if (!options.teams) {
        try {
            var reply = await redis.get(keys.teamScores(options.room));

            if (!reply) {
                logger.error("No teamInfo, may have been called at the wrong time.");
            }

            var teamsInfo;
            try {
                teamsInfo = JSON.parse(reply);
            } catch (err) {
                logger.error(`wdfScoring::teambattle::getPlayerScoringInfo(): Error parsing team info JSON for room '${options.room}': ${err.message}`);
                throw err;
            }

            teams = Object.keys(teamsInfo);
        } catch (err) {
            logger.error(`wdfScoring::teambattle::getPlayerScoringInfo(): Error retrieving team info for room '${options.room}': ${err.message}`);
            throw err;
        }
    } else {
        teams = options.teams;
    }

    // check which team the current pid is in.
    var multi = redis.multi();
    teams.forEach((team) => {
        multi.zScore(keys.playerScores(options.room, team), options.pid);
    });

    try {
        var replies = await multi.exec();

        if (replies[0] !== null) {
            return {
                team: teams[0],
                score: replies[0],
            };
        } else if (replies[1] !== null) {
            return {
                team: teams[1],
                score: replies[1],
            };
        } else {
            logger.warn(`wdfScoring::teambattle::getPlayerScoringInfo(): Player '${options.pid}' not found in any team for room '${options.room}'`);
            return null;
        }
    } catch (err) {
        logger.error(`wdfScoring::teambattle::getPlayerScoringInfo(): Error retrieving player score for pid '${options.pid}' in room '${options.room}': ${err.message}`);
        throw err;
    }
};

const cleanUp = async (options) => {
    try {
        var multi = redis.multi();

        options.state.teams.forEach((team) => {
            Object.keys(keys).forEach((key) => {
                if (keys[key].length === 2) // number of arguments the keys[key] function takes
					multi.del(keys[key](options.room, team));
				else
					multi.del(keys[key](options.room));
            })
        })

        await multi.exec();
    } catch (err) {
        logger.error(`wdfScoring::teambattle::cleanUp(): Error cleaning up room '${options.room}': ${err.message}`);
        throw err;
    }
};

const start = async (options) => {
    //logger.debug(`[${options.room}] Starting teambattle scoring with teams: ${JSON.stringify(options.state.teams)}`);
    try {
        await cleanUp(options);

        var teamScores = {};

        options.state.teams.forEach((team) => {
            teamScores[team] = {
                score: 0,
                stars: 0
            };
        });

        await redis.set(keys.teamScores(options.room), JSON.stringify(teamScores));
        //logger.debug(`[${options.room}] Teambattle scoring started, initial teamScores: ${JSON.stringify(teamScores)}`);
    } catch (err) {
        logger.error(`wdfScoring::teambattle::start(): Error starting room '${options.room}': ${err.message}`);
        throw err;
    }
};

const update = async (options) => {
    //logger.debug(`[${options.room}] Updating teambattle scores for teams: ${JSON.stringify(options.teams)}`);
    try {
        var teamScores = {};

        // Use for...of instead of forEach to properly await async operations
        for (const team of options.teams) {
            teamScores[team] = {};
            var values = await redis.zRangeWithScores(keys.playerScores(options.room, team), 0, -1);

            var teamScore = 0;
            var teamStars = 0;
            for (var i = 0; i < values.length; i++) {
                var score = 0;
                var stars = 0;

                try {
                    score = parseFloat(values[i].score);
                    stars = calculateStars(score);
                }
                catch (err) {
                    logger.error(`wdfScoring::teambattle::update(): Error parsing score for player '${values[i].value}' in team '${team}' in room '${options.room}': ${err.message}`);
                    throw err;
                }

                teamScore += score;
                teamStars += stars;
            }
            teamScores[team].score = teamScore;
            teamScores[team].stars = teamStars;
        }

        //logger.debug(`[${options.room}] Computed teamScores: ${JSON.stringify(teamScores)}`);

        var multi = redis.multi();
        multi.set(keys.teamScores(options.room), JSON.stringify(teamScores));
        
        for (const team of options.teams) {
            var reply = await redis.get(keys.lastStar(options.room, team));

            var lastStarInfo = {};
            var currentLastStarPlayer;

            if (reply) {
                try {
                    currentLastStarPlayer = JSON.parse(reply);
                } catch (err) {
                    logger.error(`wdfScoring::teambattle::update(): Error parsing last star info JSON for team '${team}' in room '${options.room}': ${err.message}`);
                    throw err;
                }

                if (!currentLastStarPlayer || !currentLastStarPlayer.pid) continue;

                var dancerCardInfo = await wdfSessions.getPlayerInfo({
                    room: options.room,
                    pids: [currentLastStarPlayer.pid]
                });

                lastStarInfo = dancerCardInfo[0];
				lastStarInfo.__class = "TeamBattleEntry";
				lastStarInfo.identifier = "lastStar";
				lastStarInfo.pid = currentLastStarPlayer.pid;
				lastStarInfo.team = currentLastStarPlayer.team;
				lastStarInfo.score = currentLastStarPlayer.score;
				lastStarInfo.team = team;

                multi.set(keys.lastStarInfo(options.room, team), JSON.stringify(lastStarInfo));
            }
        }

        await multi.exec();
    } catch (err) {
        logger.error(`wdfScoring::teambattle::update(): Error updating scores for room '${options.room}': ${err.message}`);
        throw err;
    }
};

const updateScore = async (options) => {
    if (!options.score.team) 
        throw new Error("pid: " + options.pid + " sent score without team from room: " + options.room); 

    if (!options.score.hasOwnProperty("timestamp"))
        throw new Error("pid: " + options.pid + " sent score without timestamp from room: " + options.room);

    var teamBattleEntries = [];
    var teamScores = {};
    var teams;

    var playerStars = Math.floor((options.score.score * 13333)/2000);

    var previousStats;
    // Get get the previous score and set the new score of the player.
    // Get the Last Star info and the team scores to return in the update score result.
    try {
        var multi = redis.multi();

        multi.zScore(keys.playerScores(options.room, options.score.team), options.pid);
        multi.get(keys.teamScores(options.room));
        multi.zAdd(keys.playerScores(options.room, options.score.team), { score: options.score.score, value: options.pid });
        multi.zScore(keys.longestStreak(options.room), options.pid);

        var replies = await multi.exec();

        try {
            previousPlayerStars = replies[0] ? Math.floor((parseFloat(replies[0]) * 13333)/2000) : 0;
			teamScores = JSON.parse(replies[1]);
			previousStreak = replies[3] ? parseInt(replies[3]) : 0;
		    teams = Object.keys(teamScores);
        } catch (err) {
            throw err;
        }

        previousStats = {
            previousPlayerStars: previousPlayerStars,
            previousStreak: previousStreak
        };
    } catch (err) {
        logger.error(`wdfScoring::teambattle::updateScore(): Error updating score for pid '${options.pid}' in room '${options.room}': ${err.message}`);
        throw err;
    }

    // If scored a new star set the LastStar
    try {
        var multi = redis.multi();

        if (previousStats.previousStreak < options.score.streak)
            multi.zAdd(keys.longestStreak(options.room), { score: options.score.streak, value: options.pid });

        if (playerStars > previousStats.previousPlayerStars) {
            multi.set(keys.lastStar(options.room, options.score.team), JSON.stringify({
                pid: options.pid,
                team: options.score.team,
                score: options.score.score,
                timestamp: options.score.timestamp
            }));

            multi.setNX(keys.firstStar(options.room), JSON.stringify({
                pid: options.pid,
                team: options.score.team,
                score: options.score.score,
                timestamp: options.score.timestamp
            }));
        }

        await multi.exec();
    } catch (err) {
        logger.error(`wdfScoring::teambattle::updateScore(): Error updating last star for pid '${options.pid}' in room '${options.room}': ${err.message}`);
        throw err;
    }

    // Get last star for both sides.
    try {
        var multi = redis.multi();

        teams.forEach((team) => {
            multi.get(keys.lastStarInfo(options.room, team));
        });

        var replies = await multi.exec();

        replies.forEach((reply) => {
            if (reply) {
                try {
                    var lastStarInfo = JSON.parse(reply);
                    teamBattleEntries.push(lastStarInfo);
                } catch (err) {
                    logger.error(`wdfScoring::teambattle::updateScore(): Error parsing last star info JSON in room '${options.room}': ${err.message}`);
                    throw err;
                }
            }
        });
    } catch (err) {
        logger.error(`wdfScoring::teambattle::updateScore(): Error getting last star info for pid '${options.pid}' in room '${options.room}': ${err.message}`);
        throw err;
    }

    var teamBattleStatus = {
        "__class": "TeamBattleStatus",
        teamScores: []
    };

    teams.forEach((team) => {
        teamScores[team].__class = "TeamScore";
        teamScores[team].name = team;
        teamScores[team].clientTeam = options.score.team === team;

        teamBattleStatus.teamScores.push(teamScores[team]);
    });

    var response = {
        __class: "UpdateScoreResult",
        teamBattleStatus: teamBattleStatus,
        teamBattleEntries: teamBattleEntries
    };

    return response;
};

const selectPlayerTeam = async (options) => {
    var teams = Object.keys(options.teamScores);

    var multi = redis.multi();

    teams.forEach((team) => {
        multi.zCard(keys.playerScores(options.room, team));
    });

    try {
        var replies = await multi.exec();

        var selectedTeam = null;

        //	equal team sizes 	- send to losing team
		//	unequal team sizes  - send to smaller team

        try {
            var teamASize = parseInt(replies[0]);
            var teamBSize = parseInt(replies[1]);

            var teamAStars = options.teamScores[teams[0]].stars;
            var teamBStars = options.teamScores[teams[1]].stars;

            if (teamASize === teamBSize) {
                selectedTeam = teamAStars <= teamBStars ? teams[0] : teams[1];
            } else {
                selectedTeam = teamASize < teamBSize ? teams[0] : teams[1];
            }
        } catch (err) {
            logger.error(`wdfScoring::teambattle::selectPlayerTeam(): Error selecting team for pid '${options.pid}' in room '${options.room}': ${err.message}`);
            throw err;
        }

        return selectedTeam;
    } catch (err) {
        logger.error(`wdfScoring::teambattle::selectPlayerTeam(): Error retrieving team sizes for room '${options.room}': ${err.message}`);
        throw err;
    }
};

const getScoreStatus = async (options) => {
    var playerScore;
    var teamScores;
    var teams;

    // get team scores
    try {
        var reply = await redis.get(keys.teamScores(options.room));

        try {
            teamScores = JSON.parse(reply);
            teams = Object.keys(teamScores);
        } catch (err) {
            logger.error(`wdfScoring::teambattle::getScoreStatus(): Error parsing team scores JSON for room '${options.room}': ${err.message}`);
            throw err;
        }
    } catch (err) {
        logger.error(`wdfScoring::teambattle::getScoreStatus(): Error retrieving team scores for room '${options.room}': ${err.message}`);
        throw err;
    }

    // check if player previously existed
    var playerTeam = null;
    try {
        for (const team of teams) {
            var value = await redis.zScore(keys.playerScores(options.room, team), options.pid);

            if (value !== null) {
                try {
                    playerScore = parseFloat(value);
                    playerTeam = team;
                    break;
                } catch (err) {
                    logger.error(`wdfScoring::teambattle::getScoreStatus(): Error parsing player score for pid '${options.pid}' in room '${options.room}': ${err.message}`);
                    throw err;
                }
            }
        }
    } catch (err) {
        logger.error(`wdfScoring::teambattle::getScoreStatus(): Error retrieving player score for pid '${options.pid}' in room '${options.room}': ${err.message}`);
        throw err;
    }

    // Check for team and assign one to the client
    try {
        if (!playerTeam) {
            playerTeam = await selectPlayerTeam({
                room: options.room,
                pid: options.pid,
                teamScores: teamScores
            });

            await redis.zAdd(keys.playerScores(options.room, playerTeam), { score: 0, value: options.pid });
        }
    } catch (err) {
        logger.error(`wdfScoring::teambattle::getScoreStatus(): Error selecting team for pid '${options.pid}' in room '${options.room}': ${err.message}`);
        throw err;
    }

    // Get info about theme status
    var teamBattleStatus = {
        "__class": "TeamBattleStatus",
        teamScores: []
    };

    teams.forEach((team) => {
        teamScores[team].__class = "TeamScore";
        teamScores[team].name = team;
        teamScores[team].clientTeam = playerTeam === team;

        teamBattleStatus.teamScores.push(teamScores[team]);
    });

    var response = {
        __class: "InitScoreResult",
        teamBattleStatus: teamBattleStatus,
        score: playerScore || 0
    };

    return response;
};

const computeRecap = async (options) => {
    //logger.debug(`[${options.room}] Computing teambattle recap for teams: ${JSON.stringify(options.teams)}`);
    var teamScores = {};
    var highlightEntries = [];
    var longestStreak;
    var teams = options.teams;

    // Use for...of to properly await async operations
    for (const team of options.teams) {
        await wdfLeaderboard.addPointsFromScore({
            room: options.room,
            playerScoresKey: keys.playerScores(options.room, team),
            roomGameVersion: options.state.roomGameVersion,
        });
    }

    try {
        var multi = redis.multi();

        multi.get(keys.teamScores(options.room));
        multi.get(keys.firstStar(options.room));
        multi.zRangeWithScores(keys.longestStreak(options.room), 0, 0), { REV: true };

        teams.forEach((team) => {
            multi.get(keys.lastStar(options.room, team));
        });

        var replies = await multi.exec();
        //logger.debug(`[${options.room}] computeRecap redis replies: teamScores=${replies[0]}, firstStar=${replies[1]}, longestStreak=${JSON.stringify(replies[2])}`);

        try {
            teamScores = JSON.parse(replies[0]);

            longestStreak = replies[2];
            if (replies[1]) {
                var firstStar = JSON.parse(replies[1]);
                highlightEntries.push({
                    identifier: "firstStar",
                    highlightScore: firstStar.score,
                    pid: firstStar.pid,
                    team: firstStar.team,
                    timestamp: firstStar.timestamp
                });
            }

            var lastStarTeamA = { timestamp: 0 };
            var lastStarTeamB = { timestamp: 0 };

            if (replies[3]) {
                lastStarTeamA = JSON.parse(replies[3]);
                lastStarTeamA.stars = Math.floor((parseFloat(lastStarTeamA.score) * 13333)/2000);
            }

            if (replies[4]) {
                lastStarTeamB = JSON.parse(replies[4]);
                lastStarTeamB.stars = Math.floor((parseFloat(lastStarTeamB.score) * 13333)/2000);
            }

            if (lastStarTeamA.timestamp > 0 && lastStarTeamA.timestamp > lastStarTeamB.timestamp) {
                highlightEntries.push({
                    identifier: "lastStar",
                    highlightScore: lastStarTeamA.score,
                    pid: lastStarTeamA.pid,
                    team: lastStarTeamA.team,
                    timestamp: lastStarTeamA.timestamp
                });
            } else if (lastStarTeamB.timestamp > 0) {
                highlightEntries.push({
                    identifier: "lastStar",
                    highlightScore: lastStarTeamB.score,
                    pid: lastStarTeamB.pid,
                    team: lastStarTeamB.team,
                    timestamp: lastStarTeamB.timestamp
                });
            }
        } catch (err) {
            logger.error(`wdfScoring::teambattle::computeRecap(): Error parsing JSON for room '${options.room}': ${err.message}`);
            throw err;
        }

        // Pushing Stats
        try {
            if (longestStreak && longestStreak.length > 0) {
                var longestStreakEntry = longestStreak[0];
                if (!longestStreakEntry || !longestStreakEntry.value) {
                    //logger.debug(`[${options.room}] No longest streak entry found`);
                } else {
                    var info = await getPlayerScoringInfo({
                        room: options.room,
                        teams: options.teams,
                        pid: longestStreakEntry.value
                    });

                    if (info && info.team) {
                        highlightEntries.push({
                            identifier: "longestStreak",
                            highlightScore: parseFloat(longestStreakEntry.score),
                            pid: longestStreakEntry.value,
                            team: info.team
                        });
                    } else {
                        logger.warn(`wdfScoring::teambattle::computeRecap(): Could not determine team for longest streak player '${longestStreakEntry.value}' in room '${options.room}'`);
                    }
                }
            }
        } catch (err) {
            logger.error(`wdfScoring::teambattle::computeRecap(): Error retrieving longest streak info for room '${options.room}': ${err.message}`);
            throw err;
        }

        try {
            var multi = redis.multi();

            teams.forEach((team) => {
                multi.zRangeWithScores(keys.playerScores(options.room, team), 0, 0, { REV: true });
            });

            var replies = await multi.exec();

            if (!replies[0].length || !replies[1].length) {
                //logger.debug(`[${options.room}] No top scorer entries found`);
            } else {
                var teamATopScorer = replies[0][0];
				var teamBTopScorer = replies[1][0];

				var topScorer;
				var topScorerTeam;
				try {
					if((parseFloat(teamATopScorer.score || 0)) > (parseFloat(teamBTopScorer.score || 0))) {
						topScorer = teamATopScorer;
						topScorerTeam = teams[0];
					}
					else {
						topScorer = teamBTopScorer;
						topScorerTeam = teams[1];
					}
					highlightEntries.push({
						identifier:"topScorer",
						highlightScore: parseFloat(topScorer.score),
						pid: topScorer.value,
						team: topScorerTeam
					});
				} catch(err) {
					throw err;
				}
            }
        } catch (err) {
            logger.error(`wdfScoring::teambattle::computeRecap(): Error retrieving top scorer info for room '${options.room}': ${err.message}`);
            throw err;
        }

        var teamBattleEntries;
        try {
            var pids = [];
            for (var i in highlightEntries) {
                pids.push(highlightEntries[i].pid);
            }

            var dancerCardInfos = await wdfSessions.getPlayerInfo({
                room: options.room,
                pids: pids
            });

            var highlights = [];
            for (var j = 0; j < dancerCardInfos.length; j++) {
                var highlight = dancerCardInfos[j];

                highlight.__class = "TeamBattleEntry";
                highlight.pid = highlightEntries[j].pid;
                highlight.identifier = highlightEntries[j].identifier;
                highlight.team = highlightEntries[j].team;
                highlight.score = highlightEntries[j].highlightScore;
                highlight.timestamp = highlightEntries[j].timestamp || 0;
                highlights.push(highlight);
            }

            teamBattleEntries = highlights;
        } catch (err) {
            logger.error(`wdfScoring::teambattle::computeRecap(): Error retrieving highlight entries info for room '${options.room}': ${err.message}`);
            throw err;
        }

        var teamBattleStatus = {
            "__class": "TeamBattleStatus",
            teamScores: []
        };

        teams.forEach((team) => {
            teamScores[team].__class = "TeamScore";
            teamScores[team].name = team;
            teamScores[team].clientTeam = false; // false by default, will be changed in getRecap

            teamBattleStatus.teamScores.push(teamScores[team]);
        });

        var recapInfo = {
            __class: "RecapInfo",
            teamBattleStatus: teamBattleStatus,
            teamBattleEntries: teamBattleEntries
        };

        try {
            var multi = redis.multi();

            multi.set(keys.recap(options.room), JSON.stringify(recapInfo));
            multi.set(keys.recapComputed(options.room), "true");

            await multi.exec();
            //logger.debug(`[${options.room}] Recap stored successfully, recapInfo: ${JSON.stringify(recapInfo)}`);
        } catch (err) {
            logger.error(`wdfScoring::teambattle::computeRecap(): Error storing recap info for room '${options.room}': ${err.message}`);
            throw err;
        }
    } catch (err) {
        logger.error(`wdfScoring::teambattle::computeRecap(): Error computing recap for room '${options.room}': ${err.message}`);
        throw err;
    }
};

const getRecap = async (options) => {
    //logger.debug(`[${options.room}] getRecap called for pid ${options.pid}`);
    try {
        var recapComputed = await redis.get(keys.recapComputed(options.room));
        //logger.debug(`[${options.room}] recapComputed value from Redis: ${recapComputed}`);

        if (!recapComputed || recapComputed !== "true") {
            //logger.debug(`[${options.room}] Recap not computed yet, returning recapComputed: false`);
            return {
                __class: "RecapInfo",
                recapComputed: false
            }
        }
    } catch (err) {
        logger.error(`wdfScoring::teambattle::getRecap(): Error checking if recap computed for room '${options.room}': ${err.message}`);
        throw err;
    }

    var recapResponse;
    try {
        var data = await redis.get(keys.recap(options.room));

        try {
            recapResponse = JSON.parse(data);
            recapResponse.recapComputed = true;
        } catch (err) {
            logger.error(`wdfScoring::teambattle::getRecap(): Error parsing recap info JSON for room '${options.room}': ${err.message}`);
            throw err;
        }
    } catch (err) {
        logger.error(`wdfScoring::teambattle::getRecap(): Error retrieving recap info for room '${options.room}': ${err.message}`);
        throw err;
    }

    try {
        var teams = [];

        recapResponse.teamBattleStatus.teamScores.forEach((teamScore) => {
            teams.push(teamScore.name);
        });

        var info = await getPlayerScoringInfo({
            room: options.room,
            teams: teams,
            pid: options.pid
        });

        if (info && info.team) {
            recapResponse.teamBattleStatus.teamScores[teams.indexOf(info.team)].clientTeam = true;
        } else {
            logger.warn(`wdfScoring::teambattle::getRecap(): Could not determine team for pid '${options.pid}' in room '${options.room}', skipping clientTeam assignment`);
        }
    } catch (err) {
        logger.error(`wdfScoring::teambattle::getRecap(): Error setting client team for pid '${options.pid}' in room '${options.room}': ${err.message}`);
        throw err;
    }

    try {
        if (options.gameVersion && options.gameVersion !== "jd2017") {
            var onlineRankInfo = await wdfLeaderboard.getFormattedOnlineRankInfo({
                room: options.room,
                pid: options.pid,
            });

            recapResponse.onlineRankInfo = onlineRankInfo;
        }
    } catch (err) {
        logger.error(`wdfScoring::teambattle::getRecap(): Error retrieving online rank info for pid '${options.pid}' in room '${options.room}': ${err.message}`);
        throw err;
    }

    return recapResponse;
};

const getTeamScores = async (options) => {
    try {
        var reply = await redis.zRangeWithScores(keys.playerScores(options.room), 0, -1, { REV: true });

        var teamScores = [];

        for (var i = 1; i < reply.length; i++) {
            var score;
            try {
                score = parseFloat(reply[i].score);
            } catch (err) {
                throw err;
            }
            teamScores.push({
                pid: reply[i].value,
                score: score
            });
        }

        return teamScores;
    } catch (err) {
        logger.error(`wdfScoring::teambattle::getTeamScores(): Error retrieving team scores for room '${options.room}': ${err.message}`);
        throw err;
    }
};

module.exports = {
    init,
    start,
    update,
    updateScore,
    getScoreStatus,
    cleanUp,
    computeRecap,
    getRecap,
    getTeamScores
};