const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const router2 = express.Router();
const redis = require('redis');
const seedrandom = require('seedrandom');
const validator = require("../logger/sessionvalidatorwdf");
const rateLimitMiddleware = require("../ratelimit/rate-limiter");
const logger = require("../logger/logger");
const User = require('../routes/model/User');
const {
	createClient
} = require('@redis/client');

const ModularScreenGenerator = require('./modularScreenGenerator');
const screenGenerator = new ModularScreenGenerator();
const config = require('config');
const isDevEnabled = config.get('WorldDanceFloorUserAccess.Dev');
const isPublicEnabled = config.get('WorldDanceFloorUserAccess.Public');
const isPatreonEnabled = config.get('WorldDanceFloorUserAccess.Patreon');

// Configura el cliente con la URL de tu servidor Redis
const redisUrl = 'redis://127.0.0.1:6379'; // Cambia esto si Redis está en otra IP/puerto

const client = createClient({
	url: redisUrl
});

client.on('error', (err) => {
	logger.error('WDF System:Redis client error:', err);
});

client.connect().then(() => {
	logger.info('WDF System: Redis client connected');
}).catch(err => {
	logger.error('WDF System:Failed to connect to Redis:', err);
});

// Variables principales
let currentScreen;
let screenUpdateTimeout;
let tournamentData = {
	currentTournament: {},
	currentTournamentRecap: {}
};
let voteData = {
	currentVoteSong: {},
	currentVoteRecap: {}
};
let recapStatus;

let recentMaps = [];
let ccu = 0;
let notification = null;
let tournamentRecapCounter = 0;

const voteOptions = []; // Lista de opciones de voto disponibles
let votes = {}; // Almacena los votos para cada opción
const votedUsers = new Set();
let voteTimeouts = {};
////Main Functions

const generateNewTournamentScreen = async (startTime) => {
	try {

		const tournamentTheme = screenGenerator.selectPlaylistType('tournament');
		const screens = await screenGenerator.generateTournamentScreens(startTime, tournamentTheme.config);
		
		currentScreen = screens;
		logger.info(`WDF System: New tournament screen generated using ${tournamentTheme.name} configuration`);
		
		return currentScreen;
	} catch (error) {
		logger.error('WDF System: Error generating new tournament screen:', error);
		return null;
	}
};
const generateInitialVoteScreen = async (currentTime) => {
	try {
		logger.info('WDF System: Generating initial vote screen using modular system...');
		
		const voteTheme = screenGenerator.selectPlaylistType('vote');
		const screens = await screenGenerator.generateVoteScreens(currentTime, voteTheme.config);
		
		currentScreen = screens;
		

		if (screens.screens && screens.screens[0] && screens.screens[0].voteInfo) {
			voteOptions.length = 0;
			voteOptions.push(...screens.screens[0].voteInfo.voteOptions);
			
			votes = {};
			voteOptions.forEach(option => {
				votes[option] = 0;
			});
		}
		
		logger.info(`WDF System: Vote screen generated using ${voteTheme.name} configuration`);
		return screens.screens[0]; // Return the vote screen for compatibility
	} catch (error) {
		logger.error('WDF System: Error generating initial vote screen:', error);
		return null;
	}
};

const generateFinalVoteScreen = async (winnerMapName, previousScreenEndTime) => {
	try {
		logger.info('WDF System: Generating final vote screens using modular system...');
		
		const screens = await screenGenerator.generateFinalVoteScreens(winnerMapName, previousScreenEndTime);
		
		currentScreen = {
			__class: "ScreenList",
			screens: screens
		};
		
		return screens;
	} catch (error) {
		logger.error('WDF System: Error generating final vote screens:', error);
		return null;
	}
};
const getMapLength = async (mapName) => {
	try {
		return await screenGenerator.mapSelector.getMapLength(mapName);
	} catch (error) {
		logger.error(`WDF System: Error getting map length for ${mapName}:`, error);
		return 180; // Default fallback
	}
};
const initializeTournament = () => {
	logger.info('WDF System: Initializing tournament...');
	
	client.set('currentTournament', JSON.stringify({
		MapNames: []
	}), redis.print);

	client.set('currentTournamentRecap', JSON.stringify({
		TotalScoreEntries: {}
	}), redis.print);

	logger.info("WDF System: New Tournament Started and Redis Memory Cleaned");
};
const initializeVoteMap = () => {
	logger.info('WDF System: Initializing Vote Song Scores...');

	client.set('currentVoteSong', JSON.stringify({
		MapNames: []
	}), redis.print);

	client.set('currentVoteSongRecap', JSON.stringify({
		TotalScoreEntries: {}
	}), redis.print);

	logger.info("WDF System: New Vote Mode Started and Redis Memory Cleaned");
};
const initializeScreens = async () => {
	try {
		logger.info('WDF System: Initializing screens using modular system...');
		
		const initialScreen = await screenGenerator.initializeScreens();
		
		if (initialScreen) {
			currentScreen = initialScreen;
			
			// Initialize appropriate data structures based on the generated screen type
			const firstScreen = initialScreen.screens[0];
			if (firstScreen.theme === 'vote') {
				initializeVoteMap();
				// Set up vote options for compatibility
				if (firstScreen.voteInfo && firstScreen.voteInfo.voteOptions) {
					voteOptions.length = 0;
					voteOptions.push(...firstScreen.voteInfo.voteOptions);
					votes = {};
					voteOptions.forEach(option => {
						votes[option] = 0;
					});
				}
			} else if (firstScreen.theme === 'tournament') {
				initializeTournament();
			}
			
			logger.info('WDF System: Screens initialized successfully');
		} else {
			logger.error('WDF System: Initial screen was not generated');
		}
	} catch (error) {
		logger.error(error,'WDF System: Error initializing screens:');
	}
};
// Almacena los votos recibidos
let cachedVoteResults = null;

// Función para calcular los porcentajes de los votos
const calculateVotePercentages = () => {
	const totalVotes = Object.values(votes).reduce((sum, count) => sum + count, 0);
	let voteEntries = voteOptions.map(option => {
		const count = votes[option] || 0;
		return {
			__class: 'VoteResultEntry',
			name: option,
			value: totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0
		};
	});

	// Handle edge cases
	const allVotesZero = totalVotes === 0;
	const isTie = voteEntries.length > 1 && voteEntries.every(entry => entry.value === voteEntries[0].value);

	if (allVotesZero || isTie) {
		// Assign random but close percentages if no votes or tie
		const basePercentage = Math.floor(100 / voteEntries.length);
		let remainder = 100 - (basePercentage * voteEntries.length);
		
		voteEntries = voteEntries.map((entry, index) => ({
			...entry,
			value: basePercentage + (index < remainder ? 1 : 0)
		}));
		
		// Shuffle to randomize which gets the extra percentage
		for (let i = voteEntries.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[voteEntries[i].value, voteEntries[j].value] = [voteEntries[j].value, voteEntries[i].value];
		}
	}

	// Find winner
	const winnerMapName = voteEntries.reduce((max, entry) => entry.value > max.value ? entry : max, {
		value: -1
	}).name;

	// Sort by value (winner first)
	voteEntries.sort((a, b) => b.value - a.value);

	// Cache results
	cachedVoteResults = {
		voteEntries,
		winnerMapName
	};

	logger.info(`WDF System: Vote results calculated. Winner: ${winnerMapName}`);
	return cachedVoteResults;
};

// Función para manejar el resultado de la votación
const handleVoteResult = (req, res) => {
	if (!cachedVoteResults) {
		calculateVotePercentages();
	}

	const result = {
		__class: 'VoteResult',
		entries: cachedVoteResults.voteEntries
	};

	res.status(200).json(result);
};

// Ejemplo de uso con Express.js
router.get('/wdf/v1/rooms/MainJDM/themes/vote/result', handleVoteResult);
const handleVoteChoice = async (req, res) => {
	const { voteOption } = req.body;
	
	if (!voteOption || !voteOptions.includes(voteOption)) {
		return res.status(400).json({
			error: 'Nice Try :)'
		});
	}
	const authorization = req.headers['authorization'];
	if (!authorization) {
		logger.error('WDF System:Vote Choice Error: Invalid authorization header');
		return res.status(403).send('Forbidden');
	}
	const token = authorization.substring(7, 257);
	try {
		// Get user profile data from token
		const profileKey = `userProfileData:${token}`;
		const profileDataRedis = await client.get(profileKey);
		
		if (!profileDataRedis) {
			logger.error('WDF System:Vote Choice Error: No profile data found for token');
			return res.status(403).send('Forbidden');
		}
		
		const userProfile = JSON.parse(profileDataRedis);
		const profileId = userProfile.profileId;
		
		// Check if user has an active session
		const sessionKey = `${profileId}-WDF`;
		const sessionDataStr = await client.get(sessionKey);
		
		if (!sessionDataStr) {
			logger.error(`WDF System:Vote Choice Error: No active session found for profile ${profileId}`);
			return res.status(403).send('Forbidden');
		}
		
		// Parse session data
		const sessionData = JSON.parse(sessionDataStr);
		
		// Verify session is active
		if (!sessionData.isSessionActive) {
			logger.error(`WDF System:Vote Choice Error: Session exists but is not active for profile ${profileId}`);
			return res.status(403).send('Forbidden');
		}
		
		if (votedUsers.has(profileId)) {
			return res.status(403).json({
				error: 'You have already voted'
			});
		}
		
		// Register vote and mark user as voted using profileId
		votes[voteOption] = (votes[voteOption] || 0) + 1;
		votedUsers.add(profileId);
		
		const userName = sessionData.name || 'Unknown user';
		logger.info(`WDF System: Vote received from ${userName} for ${voteOption}. Total votes: ${votes[voteOption]}`);
		
		// Respond with success
		res.status(200).json({
			message: 'OK'
		});
	} catch (error) {
		logger.error(`WDF System:Error handling vote choice: ${error.message}`);
		res.status(500).json({
			error: 'Internal server error'
		});
	}
};

const updateScreenConfiguration = (newConfig) => {
	try {
		screenGenerator.updateConfig(newConfig);
		logger.info('WDF System: Screen configuration updated');
		return true;
	} catch (error) {
		logger.error('WDF System: Error updating configuration:', error);
		return false;
	}
};
const getScreenConfiguration = () => {
	return screenGenerator.getConfig();
};
const forceRegenerateScreens = async (theme, playlistType = null) => {
	try {
		const startTime = Date.now() / 1000;
		let screens;

		if (theme === 'vote') {
			const voteConfig = playlistType 
				? screenGenerator.getConfig().vote.votePlaylist[playlistType]
				: screenGenerator.selectPlaylistType('vote').config;
			screens = await screenGenerator.generateVoteScreens(startTime, voteConfig);
		} else if (theme === 'tournament') {
			const tournamentConfig = playlistType 
				? screenGenerator.getConfig().tournament.tournamentPlaylist[playlistType]
				: screenGenerator.selectPlaylistType('tournament').config;
			screens = await screenGenerator.generateTournamentScreens(startTime, tournamentConfig);
		}

		if (screens) {
			currentScreen = screens;
			logger.info(`WDF System: Forced regeneration of ${theme} screens${playlistType ? ` with ${playlistType}` : ''}`);
		}

		return screens;
	} catch (error) {
		logger.error(`WDF System: Error force regenerating ${theme} screens:`, error);
		return null;
	}
};

router.post('/wdf/v1/rooms/MainJDM/themes/vote/choice', handleVoteChoice);

// Función para actualizar la notificación de tipo "tournament-localRank"
const generateTournamentLocalRankNotification = async (startTime) => {
	try {
		// Intenta obtener los datos de Redis
		const currentTournamentStr = await client.get('currentTournament');
		const currentMapName = await getCurrentMapName();

		let nbPlayers = 0;

		if (currentTournamentStr) {
			// Si hay datos en currentTournament, obtenemos la cantidad de jugadores desde currentTournament
			const currentTournament = JSON.parse(currentTournamentStr);
			const mapData = currentTournament.MapNames || [];

			// Encuentra el mapa actual en la lista de mapas
			const mapEntry = mapData.find(map => map.name === currentMapName);

			if (mapEntry && mapEntry.scoreEntries) {
				// Contamos el número de entradas en scoreEntries
				nbPlayers = Object.keys(mapEntry.scoreEntries).length;
			}
		}

		// Actualiza la variable global notification
		notification = {
			__class: "Notification",
			title: "You are in the Top [var:RANK]!",
			data: {
				NB_PLAYERS: {
					value: nbPlayers.toString(),
					__class: "NotificationValue"
				}
			},
			name: "tournament-localRank",
			nextNotificationCallTime: startTime + 50, // Tiempo actual + 50 segundos
			duration: 10
		};


	} catch (error) {
		logger.error("WDF System: Error generating notification:");
		notification = {
			__class: "Notification",
			title: "Welcome to JDMO WDF",
			name: "map-numberofstars",
			nextNotificationCallTime: startTime + 50, // Tiempo actual + 50 segundos
			duration: 10,
			data: {
				NB_PLAYERS: {
					value: "1",
					__class: "NotificationValue"
				}
			}
		};

		logger.info('WDF System: Generated error notification:', notification);
	}
};

const generateMapLocalRankNotification = async (startTime) => {
	try {
		// Intenta obtener los datos de Redis
		const currentTournamentStr = await client.get('currentVoteSong');
		const currentMapName = await getCurrentMapName();

		let nbPlayers = 0;

		if (currentTournamentStr) {
			// Si hay datos en currentTournament, obtenemos la cantidad de jugadores desde currentTournament
			const currentTournament = JSON.parse(currentTournamentStr);
			const mapData = currentTournament.MapNames || [];

			// Encuentra el mapa actual en la lista de mapas
			const mapEntry = mapData.find(map => map.name === currentMapName);

			if (mapEntry && mapEntry.scoreEntries) {
				// Contamos el número de entradas en scoreEntries
				nbPlayers = Object.keys(mapEntry.scoreEntries).length;
			}
		}

		// Actualiza la variable global notification
		notification = {
			__class: "Notification",
			title: "You are in the Top [var:RANK]!",
			data: {
				NB_PLAYERS: {
					value: nbPlayers.toString(),
					__class: "NotificationValue"
				}
			},
			name: "tournament-localRank",
			nextNotificationCallTime: startTime + 50, // Tiempo actual + 50 segundos
			duration: 10
		};


	} catch (error) {
		logger.error("WDF System: Error generating notification:");
		notification = {
			__class: "Notification",
			title: "Welcome to JDMO WDF",
			name: "map-numberofstars",
			nextNotificationCallTime: startTime + 50, // Tiempo actual + 50 segundos
			duration: 10,
			data: {
				NB_PLAYERS: {
					value: "1",
					__class: "NotificationValue"
				}
			}
		};

		logger.info('WDF System: Generated error notification:', notification);
	}
};
const generateMapLeaderNotification = async (startTime) => {
	try {
		// Obtén los datos de Redis
		const currentVoteSongStr = await client.get('currentVoteSong');

		const currentVoteSong = JSON.parse(currentVoteSongStr);

		// Obtener el nombre del mapa actual
		const currentMapName = await getCurrentMapName();

		// Combina las puntuaciones de los mapas
		const totalScores = {};

		currentVoteSong.MapNames.forEach(map => {
			if (map.name === currentMapName) {
				Object.values(map.scoreEntries).forEach(entry => {
					const token = entry.pid;
					const mapScore = entry.score || 0;
					if (!totalScores[token]) {
						totalScores[token] = 0;
					}
					totalScores[token] += mapScore;
				});
			}
		});

		// Encontrar el jugador con la mayor puntuación
		let leader = null;
		let maxScore = -Infinity;

		for (const [token, score] of Object.entries(totalScores)) {
			if (score > maxScore) {
				maxScore = score;
				leader = token;
			}
		}

		// Obtener los datos del jugador líder
		let leaderProfile = {};

		// Busca los datos del líder en currentVoteSong
		for (const map of currentVoteSong.MapNames) {
			const entry = Object.values(map.scoreEntries).find(entry => entry.pid === leader);
			if (entry) {
				leaderProfile = entry;
				break;
			}
		}

		// Define la notificación
		notification = {
			__class: "Notification",
			title: "[var:PLAYER_ID]",
			info: "is leading the song.",
			data: {
				PLAYER_ID: {
					value: leaderProfile.name || leader,
					__class: "NotificationValue"
				},
				nameSuffix: {
					value: "0",
					__class: "NotificationValue"
				},
				country: {
					value: leaderProfile.country.toString() || "unknown",
					__class: "NotificationValue"
				},
				avatar: {
					value: leaderProfile.avatar.toString() || "default",
					__class: "NotificationValue"
				}
			},
			name: "map-leader",
			nextNotificationCallTime: startTime + 50, // Tiempo actual + 40 segundos
			duration: 10
		};
	} catch (error) {
		logger.error("WDF System: Error generating notification:");
		notification = {
			__class: "Notification",
			title: "Welcome to JDMO WDF",
			name: "map-numberofstars",
			nextNotificationCallTime: startTime + 50, // Tiempo actual + 50 segundos
			duration: 10,
			data: {
				NB_PLAYERS: {
					value: "1",
					__class: "NotificationValue"
				}
			}
		};
	}
};
const generateTournamentLeaderOfCompetitionNotification = async (startTime) => {
	try {
		// Obtén los datos de Redis
		const currentTournamentStr = await client.get('currentTournament');
		const currentTournamentRecapStr = await client.get('currentTournamentRecap');

		const currentTournament = JSON.parse(currentTournamentStr);
		const currentTournamentRecap = currentTournamentRecapStr ? JSON.parse(currentTournamentRecapStr) : null;

		// Obtener el nombre del mapa actual
		const currentMapName = await getCurrentMapName();

		// Combina las puntuaciones de los mapas y las puntuaciones acumuladas (si están disponibles)
		const totalScores = {};

		currentTournament.MapNames.forEach(map => {
			if (map.name === currentMapName) {
				Object.values(map.scoreEntries).forEach(entry => {
					const token = entry.pid;
					const mapScore = entry.score || 0;
					if (!totalScores[token]) {
						totalScores[token] = 0;
					}
					totalScores[token] += mapScore;
				});
			}
		});

		// Si hay datos en currentTournamentRecap, añade puntuaciones acumuladas
		if (currentTournamentRecap) {
			Object.keys(currentTournamentRecap.TotalScoreEntries).forEach(token => {
				if (!totalScores[token]) {
					totalScores[token] = 0;
				}
				totalScores[token] += currentTournamentRecap.TotalScoreEntries[token].score || 0;
			});
		}

		// Encontrar el jugador con la mayor puntuación
		let leader = null;
		let maxScore = -Infinity;

		for (const [token, score] of Object.entries(totalScores)) {
			if (score > maxScore) {
				maxScore = score;
				leader = token;
			}
		}

		// Obtener los datos del jugador líder
		let leaderProfile = {};

		if (currentTournamentRecap && currentTournamentRecap.TotalScoreEntries[leader]) {
			leaderProfile = currentTournamentRecap.TotalScoreEntries[leader];
		} else {
			// Si no hay datos en currentTournamentRecap, usa los datos de currentTournament
			for (const map of currentTournament.MapNames) {
				const entry = Object.values(map.scoreEntries).find(entry => entry.pid === leader);
				if (entry) {
					leaderProfile = entry;
					break;
				}
			}
		}

		// Define la notificación
		notification = {
			__class: "Notification",
			title: "[var:PLAYER_ID]",
			info: "is leading the tournament.",
			data: {
				PLAYER_ID: {
					value: leaderProfile.name || leader,
					__class: "NotificationValue"
				},
				nameSuffix: {
					value: "0",
					__class: "NotificationValue"
				},
				country: {
					value: leaderProfile.country.toString() || "8541",
					__class: "NotificationValue"
				},
				avatar: {
					value: leaderProfile.avatar.toString() || "1682",
					__class: "NotificationValue"
				}
			},
			name: "tournament-leaderOfCompetition",
			nextNotificationCallTime: startTime + 50, // Tiempo actual + 30 segundos
			duration: 10
		};
	} catch (error) {
		logger.error("WDF System: Error generating notification:");
		notification = {
			__class: "Notification",
			title: "Welcome to JDMO WDF",
			name: "map-numberofstars",
			nextNotificationCallTime: startTime + 50, // Tiempo actual + 50 segundos
			duration: 10,
			data: {
				NB_PLAYERS: {
					value: "1",
					__class: "NotificationValue"
				}
			}
		};
	}
};
const generateNumberOfStarsCompetitionNotification = async (startTime) => {
	try {
		// Intenta obtener los datos de Redis
		const currentTournamentStr = await client.get('currentTournament');
		const currentTournamentRecapStr = await client.get('currentTournamentRecap');

		let totalStars = 0;

		// Procesar los datos de currentTournament
		if (currentTournamentStr) {
			const currentTournament = JSON.parse(currentTournamentStr);
			currentTournament.MapNames.forEach(map => {
				for (let token in map.scoreEntries) {
					if (map.scoreEntries.hasOwnProperty(token)) {
						const score = map.scoreEntries[token].score;
						totalStars += getStarsByScore(score);
					}
				}
			});
		}

		// Procesar los datos de currentTournamentRecap si tiene entradas
		if (currentTournamentRecapStr) {
			const currentTournamentRecap = JSON.parse(currentTournamentRecapStr);
			const scoreEntries = currentTournamentRecap.TotalScoreEntries;

			if (scoreEntries && Object.keys(scoreEntries).length > 0) {
				for (let token in scoreEntries) {
					if (scoreEntries.hasOwnProperty(token)) {
						const scoreEntry = scoreEntries[token];
						const score = scoreEntry.score;
						totalStars += getStarsByScore(score);
					}
				}
			}
		}

		// Define la notificación
		notification = {
			__class: "Notification",
			title: "[var:NB_STARS] [icon:STAR]",
			info: "scored during the tournament.",
			data: {
				NB_STARS: {
					value: totalStars.toString(),
					__class: "NotificationValue"
				}
			},
			name: "tournament-numberOfStarsCompetition",
			nextNotificationCallTime: startTime + 50, // Tiempo actual + 50 segundos
			duration: 10
		};
	} catch (error) {
		logger.error("WDF System: Error generating notification");
		notification = {
			__class: "Notification",
			title: "Welcome to JDMO WDF",
			name: "map-numberofstars",
			nextNotificationCallTime: startTime + 50, // Tiempo actual + 50 segundos
			duration: 10,
			data: {
				NB_PLAYERS: {
					value: "1",
					__class: "NotificationValue"
				}
			}
		};
	}
};
const generateNumberOfStarsMapNotification = async (startTime) => {
	try {
		// Intenta obtener los datos de Redis
		const currentVoteSongStr = await client.get('currentVoteSong');

		let totalStars = 0;

		if (currentVoteSongStr) {
			// Si hay datos en currentTournament, procesa los mapas y sus entradas de puntuación
			const currentVoteSong = JSON.parse(currentVoteSongStr);

			currentVoteSong.MapNames.forEach(map => {
				for (let token in map.scoreEntries) {
					if (map.scoreEntries.hasOwnProperty(token)) {
						const score = map.scoreEntries[token].score;
						totalStars += getStarsByScore(score);
					}
				}
			});
		} else {
			// Si no hay datos en Redis, establece un valor predeterminado para totalStars
			totalStars = 0;
		}

		// Define la notificación
		notification = {
			__class: "Notification",
			title: "[var:NB_STARS] [icon:STAR]",
			info: "scored during the song.",
			data: {
				NB_STARS: {
					value: totalStars.toString(),
					__class: "NotificationValue"
				}
			},
			name: "map-numberOfStars",
			nextNotificationCallTime: startTime + 50, // Tiempo actual + 30 segundos
			duration: 10
		};
	} catch (error) {
		logger.error("WDF System: Error generating notification");
		notification = {
			__class: "Notification",
			title: "Welcome to JDMO WDF",
			name: "tournament-leaderoftrack",
			nextNotificationCallTime: startTime + 50, // Tiempo actual + 50 segundos
			duration: 10,
			data: {
				NB_PLAYERS: {
					value: "1",
					__class: "NotificationValue"
				}
			}
		};
	}
};
const generateNumberOfStarsMapTNNotification = async (startTime) => {
	try {
		// Intenta obtener los datos de Redis
		const currentVoteSongStr = await client.get('currentTournament');
		const currentMapName = getCurrentMapName(); // Obtén el nombre del mapa actual

		let totalStars = 0;

		if (currentVoteSongStr) {
			// Si hay datos en currentTournament, procesa el mapa actual y sus entradas de puntuación
			const currentVoteSong = JSON.parse(currentVoteSongStr);

			currentVoteSong.MapNames.forEach(map => {
				if (map.name === currentMapName) { // Verifica si el mapa coincide con el mapa actual
					for (let token in map.scoreEntries) {
						if (map.scoreEntries.hasOwnProperty(token)) {
							const score = map.scoreEntries[token].score;
							totalStars += getStarsByScore(score);
						}
					}
				}
			});
		} else {
			// Si no hay datos en Redis, establece un valor predeterminado para totalStars
			totalStars = 0;
		}

		// Define la notificación
		notification = {
			__class: "Notification",
			title: "[var:NB_STARS] [icon:STAR]",
			info: "scored during the song.",
			data: {
				NB_STARS: {
					value: totalStars.toString(),
					__class: "NotificationValue"
				}
			},
			name: "map-numberOfStars",
			nextNotificationCallTime: startTime + 50, // Tiempo actual + 50 segundos
			duration: 10
		};
	} catch (error) {
		logger.error("WDF System: Error generating notification");
		notification = {
			__class: "Notification",
			title: "Welcome to JDMO WDF",
			name: "tournament-leaderoftrack",
			nextNotificationCallTime: startTime + 50, // Tiempo actual + 50 segundos
			duration: 10,
			data: {
				NB_PLAYERS: {
					value: "1",
					__class: "NotificationValue"
				}
			}
		};
	}
};

// Función auxiliar para obtener estrellas según la puntuación
function getStarsByScore(score) {
	if (score >= 0.9002250) return 7;
	if (score >= 0.8250206) return 6;
	if (score >= 0.7500187) return 5;
	if (score >= 0.6000150) return 4;
	if (score >= 0.4500112) return 3;
	if (score >= 0.3000075) return 2;
	if (score >= 0.1500037) return 1;
	return 0;
}

const generateCountryTournamentNotification = async (startTime) => {
	try {
		const currentTournamentStr = await client.get('currentTournament');

		let country = null;
		let nbPlayers = 0;

		// Obtener el nombre del mapa actual
		const currentMapName = await getCurrentMapName();

		// Función para contar jugadores por país en el mapa actual
		const countPlayersByCountry = (data, mapName) => {
			const playersByCountry = {};

			// Encuentra el mapa actual
			const currentMap = data.MapNames.find(map => map.name === mapName);

			if (currentMap && currentMap.scoreEntries) {
				Object.values(currentMap.scoreEntries).forEach(entry => {
					const {
						country
					} = entry;
					if (playersByCountry[country]) {
						playersByCountry[country]++;
					} else {
						playersByCountry[country] = 1;
					}
				});
			}

			return playersByCountry;
		};

		// Función para seleccionar un país aleatorio y retornar el número de jugadores
		const selectRandomCountry = (playersByCountry) => {
			const countries = Object.keys(playersByCountry);

			if (countries.length === 0) {
				notification = {
					__class: "Notification",
					title: "Welcome to JDMO WDF",
					name: "map-numberofstars",
					nextNotificationCallTime: startTime + 50, // Tiempo actual + 50 segundos
					duration: 10,
					data: {
						NB_PLAYERS: {
							value: "1",
							__class: "NotificationValue"
						}
					}
				};
				return; // Termina la función aquí
			}

			if (countries.length === 1) {
				const selectedCountry = countries[0];
				const nbPlayers = playersByCountry[selectedCountry];
				return {
					country: selectedCountry,
					nbPlayers
				};
			}

			const randomIndex = Math.floor(Math.random() * countries.length);
			const selectedCountry = countries[randomIndex];
			const nbPlayers = playersByCountry[selectedCountry];

			return {
				country: selectedCountry,
				nbPlayers
			};
		};

		if (currentTournamentStr) {
			const dataStr = currentTournamentStr;
			const data = JSON.parse(dataStr);

			// Contar jugadores por país en el mapa actual
			const playersByCountry = countPlayersByCountry(data, currentMapName);
			({
				country,
				nbPlayers
			} = selectRandomCountry(playersByCountry));
		} else {
			country = "8521";
			nbPlayers = 0;
		}

		// Define la notificación
		notification = {
			__class: "Notification",
			title: "[var:NB_PLAYERS] player(s)",
			info: "dancing from [var:COUNTRY]",
			data: {
				COUNTRY: {
					value: country ? country.toString() : "8521",
					__class: "NotificationValue"
				},
				NB_PLAYERS: {
					value: nbPlayers.toString(),
					__class: "NotificationValue"
				}
			},
			name: "country",
			nextNotificationCallTime: startTime + 50, // Tiempo actual + 50 segundos
			duration: 10
		};
	} catch (error) {
		logger.error("WDF System: Error generating notification");
		notification = {
			__class: "Notification",
			title: "Welcome to JDMO WDF",
			name: "map-numberofstars",
			nextNotificationCallTime: startTime + 50, // Tiempo actual + 50 segundos
			duration: 10,
			data: {
				NB_PLAYERS: {
					value: "1",
					__class: "NotificationValue"
				}
			}
		};
	}
};
const generateCountryVoteNotification = async (startTime) => {
	try {
		// Intenta obtener los datos de Redis
		const currentVoteSongStr = await client.get('currentVoteSong');


		let country = null;
		let nbPlayers = 0;

		// Función para contar jugadores por país
		const countPlayersByCountry = (data) => {
			const playersByCountry = {};

			data.MapNames.forEach(map => {
				if (map.scoreEntries) {
					Object.values(map.scoreEntries).forEach(entry => {
						const {
							country
						} = entry;
						if (playersByCountry[country]) {
							playersByCountry[country]++;
						} else {
							playersByCountry[country] = 1;
						}
					});
				}
			});

			return playersByCountry;
		};

		// Función para seleccionar un país aleatorio y retornar el número de jugadores
		const selectRandomCountry = (playersByCountry) => {
			const countries = Object.keys(playersByCountry);

			if (countries.length === 0) {
				notification = {
					__class: "Notification",
					title: "Welcome to JDMO WDF",
					name: "map-numberofstars",
					nextNotificationCallTime: startTime + 50, // Tiempo actual + 50 segundos
					duration: 10,
					data: {
						NB_PLAYERS: {
							value: "1",
							__class: "NotificationValue"
						}
					}
				};
				return; // Termina la función aquí
			}

			if (countries.length === 1) {
				const selectedCountry = countries[0];
				const nbPlayers = playersByCountry[selectedCountry];
				return {
					country: selectedCountry,
					nbPlayers
				};
			}

			const randomIndex = Math.floor(Math.random() * countries.length);
			const selectedCountry = countries[randomIndex];
			const nbPlayers = playersByCountry[selectedCountry];

			return {
				country: selectedCountry,
				nbPlayers
			};
		};

		if (currentVoteSongStr) {
			const dataStr = currentVoteSongStr;
			const data = JSON.parse(dataStr);

			const playersByCountry = countPlayersByCountry(data);
			({
				country,
				nbPlayers
			} = selectRandomCountry(playersByCountry));
		} else {
			country = "8521";
			nbPlayers = 0;
		}

		// Define la notificación
		notification = {
			__class: "Notification",
			title: "[var:NB_PLAYERS] player(s)",
			info: "dancing from [var:COUNTRY]",
			data: {
				COUNTRY: {
					value: country ? country.toString() : "8521",
					__class: "NotificationValue"
				},
				NB_PLAYERS: {
					value: nbPlayers.toString(),
					__class: "NotificationValue"
				}
			},
			name: "country",
			nextNotificationCallTime: startTime + 50, // Tiempo actual + 50 segundos
			duration: 10
		};
	} catch (error) {
		logger.error("WDF System: Error generating notification");
		notification = {
			__class: "Notification",
			title: "Welcome to JDMO WDF",
			name: "map-numberofstars",
			nextNotificationCallTime: startTime + 50, // Tiempo actual + 50 segundos
			duration: 10,
			data: {
				NB_PLAYERS: {
					value: "1",
					__class: "NotificationValue"
				}
			}
		};
	}
};

let isTournamentEnabled = false;
let isVoteEnabled = false;

router2.get('/wdfHandler/setVoteMode', (req, res) => {
	isVoteEnabled = true;
	isTournamentEnabled = false;
	res.status(200).json({
		message: 'Vote Lobby Started! Enabled for Notifications and Disabled tournament notifications'
	});
});
router2.post('/wdfHandler/startVote', (req, res) => {
	const {
		voteOptionsBody,
		VoteEndTimeScreen,
		screenStartTime,
		ScreenEndTime
	} = req.body;
	logger.info('WDF System: Vote screen detected. Starting vote monitoring.');

	votes = {};
	votedUsers.clear()
	voteOptions.length = 0;
	voteOptions.push(...voteOptionsBody);

	// Configurar temporizador para calcular resultados
	const voteEndTime = VoteEndTimeScreen;
	const voteResultFetchTime = voteEndTime + 7; // 7 segundos después del voteEndTime

	// Registrar el inicio de la votación
	logger.info(`WDF System: Vote options: ${voteOptions.join(', ')}`);

	// Temporizador para calcular resultados 7 segundos después del voteEndTime
	voteTimeouts[screenStartTime] = setTimeout(() => {
		const {
			voteEntries,
			winnerMapName
		} = calculateVotePercentages();
		logger.info('WDF System: Vote results calculated successfully.');

		logger.info(`WDF System: Winner Map Name: ${winnerMapName}`);

		// Pasar screen.endTime como segundo parámetro
		generateFinalVoteScreen(winnerMapName, ScreenEndTime)
			.then(finalVoteScreen => {
				if (finalVoteScreen) {

				} else {
					logger.error('WDF System:Final vote screen is undefined or null.');
				}
			})
			.catch(error => logger.error(error,'WDF System:Error generating final vote screen:'));
	}, (voteResultFetchTime - Date.now() / 1000) * 1000); // Retraso de 7 segundos después del voteEndTime
	res.status(200).json({
		message: 'New Vote Song Mode Startd!'
	});
});
const generateNewScreen = async (endTimeScreen,isWeeklyScheduled) => {
	try {
		logger.info('WDF System: Tournament-recap or vote-recap detected. Generating new screen.');
		
		const newScreen = await screenGenerator.initializeScreens(endTimeScreen,isWeeklyScheduled);
		
		if (newScreen) {
			currentScreen = newScreen;
			
			// Initialize appropriate data structures based on the generated screen type
			const firstScreen = newScreen.screens[0];
			if (firstScreen.theme === 'vote') {
				initializeVoteMap();
				// Set up vote options for compatibility
				if (firstScreen.voteInfo && firstScreen.voteInfo.voteOptions) {
					voteOptions.length = 0;
					voteOptions.push(...firstScreen.voteInfo.voteOptions);
					votes = {};
					voteOptions.forEach(option => {
						votes[option] = 0;
					});
				}
			} else if (firstScreen.theme === 'tournament') {
				initializeTournament();
				// Handle tournament counter logic
				tournamentRecapCounter++;
				if (tournamentRecapCounter >= 20) {
					tournamentRecapCounter = 0;
					recentMaps.length = 0;
					logger.info('WDF System: Counter reached 5. Cleared recentMaps array.');
				}
			}
			
			logger.info('WDF System: New screen generated successfully');
		} else {
			logger.error('WDF System: Generated screen is undefined or null.');
		}
		
		return newScreen;
	} catch (error) {
		logger.error('WDF System: Error generating new screen:', error);
		throw error;
	}
};
router2.post('/wdfHandler/genNewScreen', async (req, res) => {
		try {
		const { endTimeScreen,isWeeklyScheduled } = req.body;
		
		const newScreen = await generateNewScreen(endTimeScreen,isWeeklyScheduled);
		
		if (newScreen) {
			res.status(200).json({
				message: 'Generated new screen!',
				screenType: newScreen.screens[0].theme
			});
		} else {
			res.status(500).json({
				message: 'Failed to generate new screen'
			});
		}
	} catch (error) {
		logger.error(error,'WDF System: Error in endpoint handler:');
		res.status(500).json({
			message: 'Error generating new screen',
			error: error.message
		});
	}
});


router2.get('/wdfHandler/getScreen', (req, res) => {
	res.status(200).json(currentScreen);
});
router2.get('/wdfHandler/getCCU', (req, res) => {
	getCurrentCCU();
	res.status(200).json({
		message: `Current CCU: ${ccu}`
	});

});
router2.get('/wdfHandler/setTournamentMode', (req, res) => {
	isVoteEnabled = false;
	isTournamentEnabled = true;
	res.status(200).json({
		message: 'Tournament Mode Started! Enabled for Notifications and Disabled Vote notifications'
	});
});
router2.get('/wdfHandler/calculateScoreRecap', (req, res) => {
	setTimeout(() => {
		updateTournamentRecapData()
			.then(() => {
				recapStatus = true; // Asegúrate de que recapStatus se declara como let
			})
			.catch(error => logger.error('WDF System:Error updating tournament recap data:', error));
	}, 7550);
	res.status(200).json({
		message: 'ScoreRecap Completed'
	});
});
async function getCurrentCCU() {
	try {
		// Intentar con currentVoteSong primero
		let currentVoteSong = await client.get('currentVoteSong');
		let data = JSON.parse(currentVoteSong);
		let mapNames = data.MapNames;

		// Si currentVoteSong está vacío, intentar con currentTournament
		if (!mapNames || mapNames.length === 0) {
			const currentTournament = await client.get('currentTournament');
			data = JSON.parse(currentTournament);
			mapNames = data.MapNames;

			if (!mapNames || mapNames.length === 0) {
				ccu = 0; // Si currentTournament también está vacío, setear ccu a 0
				return;
			}
		}

		// Obtener la última entrada de MapNames
		const lastMapName = mapNames[mapNames.length - 1];

		if (!lastMapName.scoreEntries) {
			ccu = 0; // No scoreEntries found, setear ccu a 0
		} else {
			// Contar el número de entradas en scoreEntries
			// En el caso de un objeto, contar las claves del objeto
			ccu = Object.keys(lastMapName.scoreEntries).length;
		}

	} catch (error) {
		logger.error('WDF System:Error getting current CCU:', error);
		ccu = 0; // En caso de error, setear ccu a 0
	}
}

let lastTournamentNotificationIndex = -1; // Variable global para rastrear el último índice usado

function getRandomTournamentFunction() {
	const tournamentFunctions = [
		generateTournamentLocalRankNotification,
		generateTournamentLeaderOfCompetitionNotification,
		generateNumberOfStarsMapTNNotification,
		generateCountryTournamentNotification,
	];

	// Selecciona un índice aleatorio que no sea igual al último índice usado
	let randomIndex;
	do {
		randomIndex = Math.floor(Math.random() * tournamentFunctions.length);
	} while (randomIndex === lastTournamentNotificationIndex);

	// Actualiza el último índice usado
	lastTournamentNotificationIndex = randomIndex;

	// Retorna la función correspondiente al índice seleccionado
	return tournamentFunctions[randomIndex];
}

async function GenerateRandomTournamentNotification(startTime) {
	const randomFunction = getRandomTournamentFunction();
	try {
		await randomFunction(startTime);
		logger.info(`WDF System: Tournament notification generated by: ${randomFunction.name}`);
	} catch (error) {
		logger.error('WDF System:Error generating random tournament notification:', error);
	}
}

let lastVoteFunctionIndex = -1; // Variable global para rastrear el último índice usado

function getRandomVoteFunction() {
	const voteFunctions = [
		generateMapLocalRankNotification,
		generateNumberOfStarsMapNotification,
		generateMapLeaderNotification,
	];

	// Selecciona un índice aleatorio que no sea igual al último índice usado
	let randomIndex;
	do {
		randomIndex = Math.floor(Math.random() * voteFunctions.length);
	} while (randomIndex === lastVoteFunctionIndex);

	// Actualiza el último índice usado
	lastVoteFunctionIndex = randomIndex;

	// Retorna la función correspondiente al índice seleccionado
	return voteFunctions[randomIndex];
}

async function GenerateRandomVoteNotification(startTime) {
	const randomFunction = getRandomVoteFunction();
	try {
		await randomFunction(startTime);
		logger.info(`WDF System: Vote notification generated: ${randomFunction.name}`);
	} catch (error) {
		logger.error('WDF System:Error generating random vote notification:', error);
	}
}

router2.post('/wdfHandler/inGameCompute', (req, res) => {
	const {
		startTimeScreen
	} = req.body;
	let startTime = startTimeScreen;
	recapStatus = false; // Asegúrate de que recapStatus se declara como let
	logger.info('WDF System: In-game screen detected. Recap status set to false.');
	notification = {
		__class: "Notification",
		title: "Welcome to JDMO WDF",
		name: "map-numberofstars",
		nextNotificationCallTime: startTime + 50, // Tiempo actual + 50 segundos
		duration: 10,
		data: {
			NB_PLAYERS: {
				value: "1",
				__class: "NotificationValue"
			}
		}
	};

	// Configura los retrasos para las notificaciones en milisegundos
	const initialDelay = 10 * 1000; // 10 segundos
	const delayBetweenNotifications = 40 * 1000;

	// Obtén el startTime en segundos y asegúrate de que sea correcto

	// Primera notificación
	const firstNotificationDelay = initialDelay;
	setTimeout(async () => {
		try {

			if (isTournamentEnabled) {
				await GenerateRandomTournamentNotification(startTime + 10);
			}
			if (isVoteEnabled) {
				await GenerateRandomVoteNotification(startTime + 10);
			}
		} catch (error) {
			logger.error('WDF System:Error generating first set of notifications:', error);
		}
	}, firstNotificationDelay);

	// Segunda notificación
	const secondNotificationDelay = initialDelay + delayBetweenNotifications;
	setTimeout(async () => {
		try {

			if (isTournamentEnabled) {
				await GenerateRandomTournamentNotification(startTime + 50);
			}
			if (isVoteEnabled) {
				await GenerateRandomVoteNotification(startTime + 50);
			}
		} catch (error) {
			logger.error('WDF System:Error generating second set of notifications:', error);
		}
	}, secondNotificationDelay);

	// Tercera notificación
	const thirdNotificationDelay = initialDelay + 2 * delayBetweenNotifications;
	setTimeout(async () => {
		try {

			if (isTournamentEnabled) {
				await GenerateRandomTournamentNotification(startTime + 90);
			}
			if (isVoteEnabled) {
				await GenerateRandomVoteNotification(startTime + 90);
			}
		} catch (error) {
			logger.error('WDF System:Error generating third set of notifications:', error);
		}
	}, thirdNotificationDelay);

	// Cuarta notificación
	const fourthNotificationDelay = initialDelay + 3 * delayBetweenNotifications;
	setTimeout(async () => {
		try {

			if (isTournamentEnabled) {
				await GenerateRandomTournamentNotification(startTime + 140);
			}
			if (isVoteEnabled) {
				await GenerateRandomVoteNotification(startTime + 140);
			}
		} catch (error) {
			logger.error('WDF System:Error generating third set of notifications:');
		}
	}, fourthNotificationDelay);

	// Quinta notificación
	const fifthNotificationDelay = initialDelay + 4 * delayBetweenNotifications;
	setTimeout(async () => {
		try {

			if (isTournamentEnabled) {
				await GenerateRandomTournamentNotification(startTime + 190);
			}
			if (isVoteEnabled) {
				await GenerateRandomVoteNotification(startTime + 190);
			}
		} catch (error) {
			logger.error('WDF System:Error generating fifth notification:');
		}
	}, fifthNotificationDelay);

	// Sexta notificación
	const sixthNotificationDelay = initialDelay + 5 * delayBetweenNotifications;
	setTimeout(async () => {
		try {

			if (isTournamentEnabled) {
				await GenerateRandomTournamentNotification(startTime + 240);
			}
			if (isVoteEnabled) {
				await GenerateRandomVoteNotification(startTime + 240);
			}
		} catch (error) {
			logger.error('WDF System:Error generating sixth notification:');
		}
	}, sixthNotificationDelay);
	const seventhNotificationDelay = initialDelay + 6 * delayBetweenNotifications;
	setTimeout(async () => {
		try {
			notification = {
				__class: "Notification",
				title: "Welcome to JDMO WDF",
				name: "map-numberofstars",
				nextNotificationCallTime: startTime + 290 + 50, // Tiempo actual + 50 segundos
				duration: 10,
				data: {
					NB_PLAYERS: {
						value: "1",
						__class: "NotificationValue"
					}
				}
			};
			logger.info('WDF System: 7. Tournament last notification generated.');
		} catch (error) {
			logger.error('WDF System:Error generating last notification:');
		}
	}, seventhNotificationDelay);

	// Detén el intervalo después de la última notificación
	setTimeout(() => {
		// Código para detener cualquier intervalo si es necesario
	}, seventhNotificationDelay + 1000);
	res.status(200).json({
		message: 'In-game Completed'
	});

});

const getCurrentMapName = () => {
	const currentTime = Date.now() / 1000;

	if (!currentScreen || !currentScreen.screens) {
		return null;
	}

	const screens = currentScreen.screens;

	// Buscar la pantalla activa en el momento actual
	const activeScreen = screens.find(screen => screen.startTime <= currentTime && currentTime <= screen.endTime);

	// Devolver el nombre del mapa si la pantalla activa tiene un mapa asignado
	return activeScreen.mapName;
};

const updateScoresVote = async (req, res) => {
	const { score } = req.body;
	try {
		const authorization = req.headers['authorization'];
		if (!authorization) {
			logger.error('WDF System:Error: No authorization header');
			return res.status(403).send('Forbidden');
		}

		let profileData = null;
		let profileId = null;

		if (authorization.startsWith('Bot_v1')) {
			const guid = authorization.split(' ')[1];
			profileId = guid;
			const sessionKey = `${profileId}-WDF`;
			const sessionDataStr = await client.get(sessionKey);

			if (!sessionDataStr) {
				logger.error(`WDF System:Error: No active session found for Bot ${profileId}`);
				return res.status(403).send('Forbidden');
			}

			const sessionData = JSON.parse(sessionDataStr);

			if (!sessionData.isSessionActive) {
				logger.error(`WDF System:Error: Bot session is not active for ${profileId}`);
				return res.status(403).send('Forbidden');
			}
			profileData = {
				name: req.headers['x-jd-name'] || 'Bot',
				avatar: parseInt(req.headers['x-jd-avatar']) || 0,
				country: 9627,
				skin: parseInt(req.headers['x-jd-skin']) || 101,
				jdPoints: parseInt(req.headers['x-jd-points']) || 0,
				platformId: profileId,
				portraitBorder: parseInt(req.headers['x-jd-portraitborder']),
				profileId: profileId
			};

		} else {
			const token = authorization.substring(7, 257);
			const tokenKey = `validatedTokens:${token}`;
			const profileKey = `userProfileData:${token}`;
			const profileDataRedis = await client.get(profileKey);

			if (!profileDataRedis) {
				logger.error('WDF System:Error: No profile data found for token');
				return res.status(403).send('Forbidden');
			}

			const userProfile = JSON.parse(profileDataRedis);
			profileId = userProfile.profileId;

			const sessionKey = `${profileId}-WDF`;
			const sessionDataStr = await client.get(sessionKey);
			if (!sessionDataStr) {
				logger.error(`WDF System:Error: No active session found for profile ${profileId}`);
				return res.status(403).send('Forbidden');
			}
			const sessionData = JSON.parse(sessionDataStr);
			if (!sessionData.isSessionActive) {
				logger.error(`WDF System:Error: Session not active for ${profileId}`);
				return res.status(403).send('Forbidden');
			}

			// Verificar puntaje
			if (score > 1.0000001 || score < 0) {
				logger.error(`User tried to cheat in vote ${profileId} and was banned`);
				await client.del(sessionKey);
				await client.del(tokenKey);
				await User.findOneAndUpdate(
					{ profileId: profileId },
					{ isPatreon: false, isBanned: true, isDev: false }
				);
				return res.status(403).send('Forbidden');
			}

			const now = new Date();
			if (!sessionData.lastActive || (now - new Date(sessionData.lastActive)) > 5 * 60 * 1000) {
				sessionData.lastActive = now.toISOString();
				await client.set(sessionKey, JSON.stringify(sessionData), {
					EX: 14400
				});
			}
			profileData = sessionData;
		}

		const voteDataStr = await client.get('currentVoteSong');
		const voteData = voteDataStr ? JSON.parse(voteDataStr) : { MapNames: [] };

		if (!voteData.MapNames) {
			logger.error('WDF System:Error: No current vote data found');
			return res.status(404).send('No current vote data found');
		}

		const mapName = getCurrentMapName();
		if (!mapName) {
			logger.error('WDF System:Error: No current map name found');
			return res.status(400).send('No current map name found');
		}

		let mapData = voteData.MapNames.find(map => map.name === mapName);
		if (!mapData) {
			mapData = {
				name: mapName,
				scoreEntries: {}
			};
			voteData.MapNames.push(mapData);
		}

		const newScoreEntry = {
			"name": profileData.name,
			"avatar": profileData.avatar,
			"country": profileData.country,
			"skin": profileData.skin,
			"jdPoints": profileData.jdPoints,
			"platform": req.headers['x-skuid']?.includes('nx') ? 'nx' : 'ps4',
			"portraitBorder": profileData.portraitBorder,
			"tournamentBadge": false,
			"nameSuffix": 0,
			"__class": "ScoreEntry",
			"pid": profileData.profileId,
			"score": score
		};

		mapData.scoreEntries[profileData.profileId] = newScoreEntry;

		const sortedEntries = Object.values(mapData.scoreEntries)
			.sort((a, b) => b.score - a.score);

		const playerIndex = sortedEntries.findIndex(entry => entry.pid === profileData.profileId);
		const totalPlayerCount = sortedEntries.length;

		const numNearbyPlayers = 8;
		const halfNearby = Math.floor(numNearbyPlayers / 2);
		const startIndex = Math.max(playerIndex - halfNearby, 0);
		const endIndex = Math.min(playerIndex + halfNearby + 1, totalPlayerCount);
		const scoreEntries = sortedEntries.slice(startIndex, endIndex);

		res.json({
			"__class": "UpdateScoreResult",
			"currentRank": playerIndex + 1,
			"scoreEntries": scoreEntries,
			"totalPlayerCount": totalPlayerCount
		});

		await client.set('currentVoteSong', JSON.stringify(voteData));

	} catch (err) {
		logger.error(err, 'WDF System:Error in updateVotesong:');
		res.status(500).send('Server error');
	}
};

const updateScoresTournament = async (req, res) => {
	const { score } = req.body;

	try {
		const authorization = req.headers['authorization'];
		if (!authorization) {
			logger.error('WDF System:Error: No authorization header or invalid format');
			return res.status(403).send('Forbidden');
		}

		let profileData = null;
		let profileId = null;

		if (authorization.startsWith('Bot_v1')) {
			const guid = authorization.split(' ')[1];
			profileId = guid;
			const sessionKey = `${profileId}-WDF`;
			const sessionDataStr = await client.get(sessionKey);

			if (!sessionDataStr) {
				logger.error(`WDF System:Error: No active session found for Bot ${profileId}`);
				return res.status(403).send('Forbidden');
			}

			const sessionData = JSON.parse(sessionDataStr);
			if (!sessionData.isSessionActive) {
				logger.error(`WDF System:Error: Bot session is not active for ${profileId}`);
				return res.status(403).send('Forbidden');
			}
			profileData = {
				name: req.headers['x-jd-name'] || 'Bot',
				avatar: parseInt(req.headers['x-jd-avatar']) || 0,
				country: 9627,
				skin: 101,
				jdPoints: parseInt(req.headers['x-jd-points']) || 0,
				platformId: profileId,
				portraitBorder: parseInt(req.headers['x-jd-portraitborder']) || 0,
				profileId: profileId
			};
		} else {
			const token = authorization.substring(7, 257);
			const tokenKey = `validatedTokens:${token}`;
			const profileKey = `userProfileData:${token}`;
			const profileDataRedis = await client.get(profileKey);

			if (!profileDataRedis) {
				logger.error('WDF System:Error: No profile data found for token');
				return res.status(403).send('Forbidden');
			}

			const userProfile = JSON.parse(profileDataRedis);
			profileId = userProfile.profileId;

			const sessionKey = `${profileId}-WDF`;
			const sessionDataStr = await client.get(sessionKey);
			if (!sessionDataStr) {
				logger.error(`WDF System:Error: No active session found for profile ${profileId}`);
				return res.status(403).send('Forbidden');
			}

			const sessionData = JSON.parse(sessionDataStr);
			if (!sessionData.isSessionActive) {
				logger.error(`WDF System:Error: Session exists but is not active for profile ${profileId}`);
				return res.status(403).send('Forbidden');
			}

			if (score > 1.0000001 || score < 0) {
				logger.error(`User tried to cheat in tournament ${profileId} and was banned`);
				await client.del(sessionKey);
				await client.del(tokenKey);
				await User.findOneAndUpdate(
					{ profileId: profileId },
					{ isPatreon: false, isBanned: true, isDev: false }
				);
				return res.status(403).send('Forbidden');
			}

			const now = new Date();
			if (!sessionData.lastActive ||
				(now - new Date(sessionData.lastActive)) > 5 * 60 * 1000) {
				sessionData.lastActive = now.toISOString();
				await client.set(sessionKey, JSON.stringify(sessionData), {
					EX: 14400
				});
			}

			profileData = sessionData;
		}

		const tournamentDataStr = await client.get('currentTournament');
		const tournamentData = tournamentDataStr ? JSON.parse(tournamentDataStr) : { MapNames: [] };

		if (!tournamentData.MapNames) {
			logger.error('WDF System:Error: No current tournament data found');
			return res.status(404).send('No current tournament data found');
		}

		const mapName = getCurrentMapName();
		if (!mapName) {
			logger.error('WDF System:Error: No current map name found');
			return res.status(400).send('No current map name found');
		}

		let mapData = tournamentData.MapNames.find(map => map.name === mapName);
		if (!mapData) {
			mapData = {
				name: mapName,
				scoreEntries: {}
			};
			tournamentData.MapNames.push(mapData);
		}

		const newScoreEntry = {
			"name": profileData.name,
			"avatar": profileData.avatar,
			"country": profileData.country,
			"skin": profileData.skin || 103,
			"jdPoints": profileData.jdPoints,
			"platform": req.headers['x-skuid']?.includes('nx') ? 'nx' : 'ps4',
			"portraitBorder": profileData.portraitBorder,
			"tournamentBadge": false,
			"nameSuffix": 0,
			"__class": "ScoreEntry",
			"pid": profileData.profileId,
			"score": score
		};

		mapData.scoreEntries[profileData.profileId] = newScoreEntry;

		const sortedEntries = Object.values(mapData.scoreEntries)
			.sort((a, b) => b.score - a.score);

		const playerIndex = sortedEntries.findIndex(entry => entry.pid === profileData.profileId);
		const totalPlayerCount = sortedEntries.length;

		const numNearbyPlayers = 8;
		const halfNearby = Math.floor(numNearbyPlayers / 2);
		const startIndex = Math.max(playerIndex - halfNearby, 0);
		const endIndex = Math.min(playerIndex + halfNearby + 1, totalPlayerCount);
		const scoreEntries = sortedEntries.slice(startIndex, endIndex);

		res.json({
			"__class": "UpdateScoreResult",
			"currentRank": playerIndex + 1,
			"scoreEntries": scoreEntries,
			"totalPlayerCount": totalPlayerCount
		});

		await client.set('currentTournament', JSON.stringify(tournamentData));

	} catch (err) {
		logger.error(err, 'WDF System:Error in updateScoresTournament:');
		res.status(500).send('Server error');
	}
};

const updateTournamentRecapData = async () => {
	try {
		// Obtener los datos actuales del torneo desde Redis
		const currentTournamentStr = await client.get('currentTournament');
		if (!currentTournamentStr) {
			logger.warn('WDF System: No tournament data found in Redis avoiding recap-score compute');
			return;
		}
		const currentTournamentData = JSON.parse(currentTournamentStr);

		// Obtener los datos del resumen del torneo desde Redis
		const currentTournamentRecapStr = await client.get('currentTournamentRecap');
		let currentTournamentRecapData = currentTournamentRecapStr ? JSON.parse(currentTournamentRecapStr) : {
			TotalScoreEntries: {}
		};

		// Obtener el nombre del mapa actual
		const currentMapName = getCurrentMapName();
		if (!currentMapName) {
			logger.error('WDF System:No current map name found');
			return;
		}

		// Buscar el mapa en el array MapNames
		const currentMapData = currentTournamentData.MapNames.find(map => map.name === currentMapName);
		if (!currentMapData) {
			logger.warn(`WDF System: No scores were found for map: ${currentMapName} avoiding recap-score compute`);
			return;
		}

		// Sumar los puntajes para cada usuario en el mapa actual
		Object.entries(currentMapData.scoreEntries).forEach(([tokenCut, scoreEntry]) => {
			if (!currentTournamentRecapData.TotalScoreEntries[tokenCut]) {
				currentTournamentRecapData.TotalScoreEntries[tokenCut] = {
					score: scoreEntry.score,
					...scoreEntry
				};
			} else {
				// Si ya existe, actualizar el puntaje acumulado
				currentTournamentRecapData.TotalScoreEntries[tokenCut].score += scoreEntry.score;
			}
		});

		await client.set('currentTournamentRecap', JSON.stringify(currentTournamentRecapData));

		logger.info(currentMapName,'Map: WDF System: Recap WDF Scores Computed Correctly');
	} catch (err) {
		logger.error(err,'WDF System:Error in updateTournamentRecapData:');
	}
};

// recap 
const getScoreRecapVote = async (req, res) => {
	const authorization = req.headers['authorization'];
	if (!authorization) {
		logger.error('WDF System:Error: Invalid authorization header');
		return res.status(403).send('Forbidden');
	}
	
	const token = authorization.substring(7, 257);


	const RECAP_ADJACENT_PLAYER_COUNT = 5;  // Players around current player
	const RECAP_TOP_PLAYERS_COUNT = 3;     // Top players to always show
	const RECAP_BOTTOM_PLAYERS_COUNT = 4;   // Bottom players to always show

	// Check if recap status is false
	if (recapStatus === false) {
		return res.json({
			"__class": "RecapInfo",
			"recapComputed": false
		});
	}

	try {
		// First get user profile data from token
		const profileKey = `userProfileData:${token}`;
		const profileDataRedis = await client.get(profileKey);
		
		if (!profileDataRedis) {
			logger.error('WDF System:Error: No profile data found for token');
			return res.status(403).send('Forbidden');
		}
		
		const userProfile = JSON.parse(profileDataRedis);
		const profileId = userProfile.profileId;
		
		// Check if user has an active session
		const sessionKey = `${profileId}-WDF`;
		const sessionDataStr = await client.get(sessionKey);
		
		if (!sessionDataStr) {
			logger.error(`WDF System:Error: No active session found for profile ${profileId}`);
			return res.status(403).send('Forbidden');
		}
		
		// Parse session data and verify it's active
		const profileData = JSON.parse(sessionDataStr);
		if (!profileData.isSessionActive) {
			logger.error(`WDF System:Error: Session exists but is not active for profile ${profileId}`);
			return res.status(403).send('Forbidden');
		}

		// Get current vote song data from Redis
		const voteDataStr = await client.get('currentVoteSong');
		if (!voteDataStr) {
			return res.json({
				"__class": "RecapInfo",
				"currentRank": 0,
				"recapEntries": [],
				"totalPlayerCount": 0,
				"onlineRankInfo": {
					"__class": "WDFOnlineRankInfo",
					"rank": 2768,
					"wdfPoints": 50
				},
				"recapComputed": true
			});
		}
		const currentSong = JSON.parse(voteDataStr);

		// Get current map name
		const mapName = getCurrentMapName();
		if (!mapName) {
			return res.json({
				"__class": "RecapInfo",
				"recapComputed": false
			});
		}

		// Find map data
		const mapData = currentSong.MapNames.find(map => map.name === mapName);
		if (!mapData) {
			return res.json({
				"__class": "RecapInfo",
				"currentRank": 0,
				"recapEntries": [],
				"totalPlayerCount": 0,
				"onlineRankInfo": {
					"__class": "WDFOnlineRankInfo",
					"rank": 2768,
					"wdfPoints": 50
				},
				"recapComputed": true
			});
		}

	
		const getSmartPlayerSelection = (allPlayers, playerRank, totalNumberOfPlayers) => {
			const neighbourOneSidePlayerCount = RECAP_ADJACENT_PLAYER_COUNT;
			const topPlayerCount = RECAP_TOP_PLAYERS_COUNT;
			const bottomPlayerCount = RECAP_BOTTOM_PLAYERS_COUNT;
			
	
			let neighbourBottomSidePlayerCount = neighbourOneSidePlayerCount;
			if (playerRank >= (totalNumberOfPlayers - bottomPlayerCount - neighbourOneSidePlayerCount)) {
				neighbourBottomSidePlayerCount = totalNumberOfPlayers - playerRank - bottomPlayerCount - 1;
			}
			const maxNumberOfPlayers = topPlayerCount + neighbourOneSidePlayerCount + 1 + neighbourBottomSidePlayerCount + bottomPlayerCount;
			
		
			if (totalNumberOfPlayers <= maxNumberOfPlayers) {
				return allPlayers;
			}
			
			let lowerLimit1 = 0;
			let upperLimit1 = topPlayerCount - 1;
			let lowerLimit2 = playerRank - neighbourOneSidePlayerCount;
			let upperLimit2 = playerRank + neighbourOneSidePlayerCount;
			let lowerLimit3 = totalNumberOfPlayers - bottomPlayerCount;
			let upperLimit3 = totalNumberOfPlayers - 1;
			
	
			if (playerRank <= topPlayerCount + neighbourOneSidePlayerCount) {
				lowerLimit2 = topPlayerCount;
				upperLimit2 = topPlayerCount + 2 * neighbourOneSidePlayerCount;
			} else if (playerRank >= totalNumberOfPlayers - bottomPlayerCount - neighbourOneSidePlayerCount) {
				upperLimit2 = totalNumberOfPlayers - bottomPlayerCount - 1;
			}
			
			// Ensure bounds are valid
			lowerLimit2 = Math.max(0, lowerLimit2);
			upperLimit2 = Math.min(totalNumberOfPlayers - 1, upperLimit2);
			lowerLimit3 = Math.max(0, lowerLimit3);
			
			const selectedPlayers = [];
			const addedPids = new Set(); 
			
		
			for (let i = lowerLimit1; i <= upperLimit1 && i < allPlayers.length; i++) {
				if (!addedPids.has(allPlayers[i].pid)) {
					selectedPlayers.push(allPlayers[i]);
					addedPids.add(allPlayers[i].pid);
				}
			}
			
	
			for (let i = lowerLimit2; i <= upperLimit2 && i < allPlayers.length; i++) {
				if (!addedPids.has(allPlayers[i].pid)) {
					selectedPlayers.push(allPlayers[i]);
					addedPids.add(allPlayers[i].pid);
				}
			}
			
			
			for (let i = lowerLimit3; i <= upperLimit3 && i < allPlayers.length; i++) {
				if (!addedPids.has(allPlayers[i].pid)) {
					selectedPlayers.push(allPlayers[i]);
					addedPids.add(allPlayers[i].pid);
				}
			}
			
			return selectedPlayers.sort((a, b) => b.score - a.score);
		};


		const sortedEntries = Object.values(mapData.scoreEntries || {})
			.map(entry => {
				const { ip, ...entryWithoutIp } = entry; // Remove IP from score entry
				return entryWithoutIp;
			})
			.sort((a, b) => b.score - a.score);

		const playerIndex = sortedEntries.findIndex(entry => entry.pid === profileId);
		const totalPlayerCount = sortedEntries.length;
		const currentRank = playerIndex !== -1 ? playerIndex + 1 : 0;


		const recapEntries = getSmartPlayerSelection(sortedEntries, playerIndex, totalPlayerCount);

		profileData.lastActive = new Date().toISOString();
		await client.set(sessionKey, JSON.stringify(profileData), {
			EX: 14400 
		});

		res.json({
			"__class": "RecapInfo",
			"currentRank": currentRank,
			"recapEntries": recapEntries,
			"totalPlayerCount": totalPlayerCount,
			"onlineRankInfo": {
				"__class": "WDFOnlineRankInfo",
				"rank": 2768,
				"wdfPoints": 50
			},
			"recapComputed": true
		});
	} catch (err) {
		logger.error(err, 'WDF System:Error in getScoreRecapVote:');
		res.status(500).send('Server error');
	}
};


const getScoreRecapTournament = async (req, res) => {
	const authorization = req.headers['authorization'];
	if (!authorization) {
		logger.error('WDF System:Error: Invalid authorization header');
		return res.status(403).send('Forbidden');
	}
	const token = authorization.substring(7, 257);

	// Check if recap status is false
	if (recapStatus === false) {
		return res.json({
			"__class": "RecapInfo",
			"recapComputed": false
		});
	}


	const RECAP_ADJACENT_PLAYER_COUNT = 5;  
	const RECAP_TOP_PLAYERS_COUNT = 3;    
	const RECAP_BOTTOM_PLAYERS_COUNT = 4;   

	try {
		// First get user profile data from token
		const profileKey = `userProfileData:${token}`;
		const profileDataRedis = await client.get(profileKey);
		
		if (!profileDataRedis) {
			logger.error('WDF System:Error: No profile data found for token');
			return res.status(403).send('Forbidden');
		}
		
		const userProfile = JSON.parse(profileDataRedis);
		const profileId = userProfile.profileId;
		
		// Check if user has an active session
		const sessionKey = `${profileId}-WDF`;
		const sessionDataStr = await client.get(sessionKey);
		
		if (!sessionDataStr) {
			logger.error(`WDF System:Error: No active session found for profile ${profileId}`);
			return res.status(403).send('Forbidden');
		}
		
		// Parse session data and verify it's active
		const profileData = JSON.parse(sessionDataStr);
		if (!profileData.isSessionActive) {
			logger.error(`WDF System:Error: Session exists but is not active for profile ${profileId}`);
			return res.status(403).send('Forbidden');
		}

		// Get current tournament data from Redis
		const tournamentDataStr = await client.get('currentTournament');
		if (!tournamentDataStr) {
			return res.json({
				"__class": "RecapInfo",
				"currentRank": 0,
				"recapEntries": [],
				"totalPlayerCount": 0,
				"tournamentRank": 0,
				"tournamentRecapEntries": [],
				"tournamentTotalPlayerCount": 0,
				"onlineRankInfo": {
					"__class": "WDFOnlineRankInfo",
					"rank": 2768,
					"wdfPoints": 50
				},
				"recapComputed": true
			});
		}
		const currentTournament = JSON.parse(tournamentDataStr);

		// Get current tournament recap data from Redis
		const tournamentRecapDataStr = await client.get('currentTournamentRecap');
		if (!tournamentRecapDataStr) {
			return res.json({
				"__class": "RecapInfo",
				"currentRank": 0,
				"recapEntries": [],
				"totalPlayerCount": 0,
				"tournamentRank": 0,
				"tournamentRecapEntries": [],
				"tournamentTotalPlayerCount": 0,
				"onlineRankInfo": {
					"__class": "WDFOnlineRankInfo",
					"rank": 2768,
					"wdfPoints": 50
				},
				"recapComputed": true
			});
		}
		const currentTournamentRecap = JSON.parse(tournamentRecapDataStr);

		// Get current map name
		const mapName = getCurrentMapName();
		if (!mapName) {
			return res.json({
				"__class": "RecapInfo",
				"recapComputed": false
			});
		}

		// Find map data
		const mapData = currentTournament.MapNames.find(map => map.name === mapName);
		if (!mapData) {
			return res.json({
				"__class": "RecapInfo",
				"currentRank": 0,
				"recapEntries": [],
				"totalPlayerCount": 0,
				"tournamentRank": 0,
				"tournamentRecapEntries": [],
				"tournamentTotalPlayerCount": 0,
				"onlineRankInfo": {
					"__class": "WDFOnlineRankInfo",
					"rank": 2768,
					"wdfPoints": 50
				},
				"recapComputed": true
			});
		}
		const getSmartPlayerSelection = (allPlayers, playerRank, totalPlayers) => {
			const neighbourOneSidePlayerCount = RECAP_ADJACENT_PLAYER_COUNT;
			const topPlayerCount = RECAP_TOP_PLAYERS_COUNT;
			const bottomPlayerCount = RECAP_BOTTOM_PLAYERS_COUNT;
			
			
			let neighbourBottomSidePlayerCount = neighbourOneSidePlayerCount;
			if (playerRank >= (totalPlayers - bottomPlayerCount - neighbourOneSidePlayerCount)) {
				neighbourBottomSidePlayerCount = totalPlayers - playerRank - bottomPlayerCount - 1;
			}
			const maxNumberOfPlayers = topPlayerCount + neighbourOneSidePlayerCount + 1 + neighbourBottomSidePlayerCount + bottomPlayerCount;
			
		
			if (totalPlayers <= maxNumberOfPlayers) {
				return allPlayers;
			}
	
			let lowerLimit1 = 0;
			let upperLimit1 = topPlayerCount - 1;
			let lowerLimit2 = playerRank - neighbourOneSidePlayerCount;
			let upperLimit2 = playerRank + neighbourOneSidePlayerCount;
			let lowerLimit3 = totalPlayers - bottomPlayerCount;
			let upperLimit3 = totalPlayers - 1;
			
		
			if (playerRank <= topPlayerCount + neighbourOneSidePlayerCount) {
				lowerLimit2 = topPlayerCount;
				upperLimit2 = topPlayerCount + 2 * neighbourOneSidePlayerCount;
			} else if (playerRank >= totalPlayers - bottomPlayerCount - neighbourOneSidePlayerCount) {
				upperLimit2 = totalPlayers - bottomPlayerCount - 1;
			}
			
	
			lowerLimit2 = Math.max(0, lowerLimit2);
			upperLimit2 = Math.min(totalPlayers - 1, upperLimit2);
			lowerLimit3 = Math.max(0, lowerLimit3);
			
			const selectedPlayers = [];
			const addedPids = new Set(); // Prevent duplicates
	
			for (let i = lowerLimit1; i <= upperLimit1 && i < allPlayers.length; i++) {
				if (!addedPids.has(allPlayers[i].pid)) {
					selectedPlayers.push(allPlayers[i]);
					addedPids.add(allPlayers[i].pid);
				}
			}
			
	
			for (let i = lowerLimit2; i <= upperLimit2 && i < allPlayers.length; i++) {
				if (!addedPids.has(allPlayers[i].pid)) {
					selectedPlayers.push(allPlayers[i]);
					addedPids.add(allPlayers[i].pid);
				}
			}
			
		
			for (let i = lowerLimit3; i <= upperLimit3 && i < allPlayers.length; i++) {
				if (!addedPids.has(allPlayers[i].pid)) {
					selectedPlayers.push(allPlayers[i]);
					addedPids.add(allPlayers[i].pid);
				}
			}
			
	
			return selectedPlayers.sort((a, b) => b.score - a.score);
		};

		// Process current round data
		const sortedEntries = Object.values(mapData.scoreEntries || {})
			.map(entry => {
				const { ip, ...entryWithoutIp } = entry;
				return entryWithoutIp;
			})
			.sort((a, b) => b.score - a.score);

		const playerIndex = sortedEntries.findIndex(entry => entry.pid === profileId);
		const totalPlayerCount = sortedEntries.length;
		const currentRank = playerIndex !== -1 ? playerIndex + 1 : 0;

		// Get smart selection for current round
		const recapEntries = getSmartPlayerSelection(sortedEntries, playerIndex, totalPlayerCount);

		// Process tournament total data
		const sortedTournamentEntries = Object.values(currentTournamentRecap.TotalScoreEntries || {})
			.map(entry => {
				const { ip, ...entryWithoutIp } = entry;
				return entryWithoutIp;
			})
			.sort((a, b) => b.score - a.score);

		const tournamentPlayerIndex = sortedTournamentEntries.findIndex(entry => entry.pid === profileId);
		const tournamentTotalPlayerCount = sortedTournamentEntries.length;
		const tournamentRank = tournamentPlayerIndex !== -1 ? tournamentPlayerIndex + 1 : 0;

		// Get smart selection for tournament
		const tournamentRecapEntries = getSmartPlayerSelection(sortedTournamentEntries, tournamentPlayerIndex, tournamentTotalPlayerCount);

		// Update last active time
		profileData.lastActive = new Date().toISOString();
		await client.set(sessionKey, JSON.stringify(profileData), {
			EX: 14400 // Reset the 4-hour expiration
		});

		res.json({
			"__class": "RecapInfo",
			"currentRank": currentRank,
			"recapEntries": recapEntries,
			"totalPlayerCount": totalPlayerCount,
			"tournamentRank": tournamentRank,
			"tournamentRecapEntries": tournamentRecapEntries,
			"tournamentTotalPlayerCount": tournamentTotalPlayerCount,
			"onlineRankInfo": {
				"__class": "WDFOnlineRankInfo",
				"rank": 2768,
				"wdfPoints": 50
			},
			"recapComputed": true
		});
	} catch (err) {
		logger.error(err, 'WDF System:Error in getScoreRecapTournament:');
		res.status(500).send('Server error');
	}
};

// Función para leer el archivo JSON
const readJsonFile = (filePath) => {
	return new Promise((resolve, reject) => {
		fs.readFile(filePath, 'utf8', (err, data) => {
			if (err) {
				reject(err);
			} else {
				resolve(JSON.parse(data));
			}
		});
	});
};
const writeJsonFile = (filePath, data) => {
	return new Promise((resolve, reject) => {
		fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8', (err) => {
			if (err) {
				reject(err);
			} else {
				resolve();
			}
		});
	});
};



router.get('/wdf/v1/rooms/MainJDM/notification', rateLimitMiddleware, validator, async (req, res) => {
	res.status(200).json(notification);
});

const readJsonFromRedis = async (key) => {
	const data = await client.get(key);
	return data ? JSON.parse(data) : {};
};


const writeJsonToRedis = async (key, jsonData) => {
	await client.set(key, JSON.stringify(jsonData));
};

////Operations
async function startServer() {
    await initializeScreens();
}
startServer();
///Module Server Time


router.get('/wdf/v1/server-time', rateLimitMiddleware, validator, (req, res) => {
	const currentTime = Date.now() / 1000; // Obtener el tiempo actual en segundos
	res.json({
		time: currentTime
	});
});

///Module Server Time

///Module update-scores - score-recap  Tournament Mode
router.post('/wdf/v1/rooms/MainJDM/themes/tournament/update-scores', validator, updateScoresTournament);
router.post('/wdf/v1/rooms/MainJDM/themes/vote/update-scores', validator, updateScoresVote);
router.get('/wdf/v1/rooms/MainJDM/themes/tournament/score-recap', rateLimitMiddleware, validator, getScoreRecapTournament);
router.get('/wdf/v1/rooms/MainJDM/themes/vote/score-recap', rateLimitMiddleware, validator, getScoreRecapVote);
///Module update-scores - score-recap

router.post('/wdf/v1/rooms/MainJDM/screens',  (req, res) => {
	res.json(currentScreen);
});

/// Module Sessions

router.post('/wdf/v1/rooms/MainJDM/session', rateLimitMiddleware, validator, async (req, res) => {
	const authorization = req.headers['authorization'];
	const token = authorization.substring(7, 257);
	const tokenKey = `validatedTokens:${token}`;
	const profileKey = `userProfileData:${token}`;
	const profileDataRedis = await client.get(profileKey);
	const tokenData = await client.get(tokenKey);
	if (authorization && authorization.startsWith('Bot_v1')) {
		try {
			// Extract bot info
			const botGuid = authorization.split(' ')[1]; // Bot_v1 {guid}
			const botName = req.headers['x-jd-name'] || `Bot_${botGuid.substring(0, 5)}`;
			const botAvatar = parseInt(req.headers['x-jd-avatar']) || 0;
			const botPoints = parseInt(req.headers['x-jd-points']) || 0;
			const botSkill = parseInt(req.headers['x-jd-skill']) || 0;
			const botPortrait = parseInt(req.headers['x-jd-portraitborder']);
			const profileId = botGuid;
			const userName = botName;

			const sessionData = {
				alias: 1,
				aliasGender: -1,
				avatar: botAvatar,
				country: 9627,
				isSessionActive: true,
				jdPoints: botPoints,
				lastActive: new Date().toISOString(),
				name: userName,
				platformId: profileId, // mimic unique ID
				portraitBorder: botPortrait,
				profileId: profileId,
				skin: 101
			};

			const sessionKey = `${profileId}-WDF`;
			await client.set(sessionKey, JSON.stringify(sessionData), {
				EX: 31536000 // 1 year in seconds
			});

			logger.info(`WDF System: Bot ${userName} started a session (GUID: ${botGuid})`);
			return res.status(200).send('OK');
		} catch (err) {
			logger.error(`WDF System: Error creating bot session: ${err.message}`);
			return res.status(500).send('Internal Server Error');
		}
	}
	try {
		const tokenInfo = JSON.parse(tokenData);
		if (!tokenData) {
			logger.error(`WDF System: Error Session Start WDF: Invalid token`);
			return res.status(403).json({
				status: 403,
				error: 'Forbidden'
			});
		}
		
		// Environment validation checks
		if (tokenInfo.Environment === "Production" && !isPublicEnabled) {
			logger.info(`WDF System: Public environment has blocked WDF Access: Access blocked to user: ${tokenInfo.UserName} is in environment ${tokenInfo.Environment}`);
			return res.status(403).json({
				status: 403,
				error: 'WDF Disabled for public environment'
			});
		}
		if (tokenInfo.Environment === "Patreon" && !isPatreonEnabled) {
			logger.info(`WDF System: Patreon environment has blocked WDF Access: Access blocked to user: ${tokenInfo.UserName} is in environment ${tokenInfo.Environment}`);
			return res.status(403).json({
				status: 403,
				error: 'WDF Disabled for patreon environment'
			});
		}
		if (tokenInfo.Environment === "Developer" && !isDevEnabled) {
			logger.warn(`WDF System: Dev environment has blocked WDF Access: Access blocked to user: ${tokenInfo.UserName} is in environment ${tokenInfo.Environment}`);
			return res.status(403).json({
				status: 403,
				error: 'WDF Disabled for developer environment'
			});
		}
		if (tokenInfo.Environment === "Crack") {
			return res.status(403).json({
				status: 403,
				error: 'WDF Disabled for crack environment'
			});
		}
		if (!profileDataRedis) {
			logger.error(`WDF System: Error Session Start WDF: Profile data not found in redis`);
			return res.status(404).json({
				status: 404,
				error: 'Not Found'
			});
		}

		const userProfile = JSON.parse(profileDataRedis);
		if (!userProfile) {
			logger.error(`WDF System: Error Session Start WDF: Profile data not found for token`);
			return res.status(404).json({
				status: 404,
				error: 'Not Found'
			});
		}
		
		const profileId = userProfile.profileId;
		const userName = userProfile.name;
		
		// Create session data with active flag - only store profile data and session status
		const sessionData = {
			...userProfile,
			isSessionActive: true,
			lastActive: new Date().toISOString()
		};
		
		// Set session in Redis with 4 hour expiration (14400 seconds)
		const sessionKey = `${profileId}-WDF`;
		await client.set(sessionKey, JSON.stringify(sessionData), {
			EX: 14400 // 4 hours in seconds
		});
		
		logger.info(`WDF System: ${userName} WDF New Session in environment ${tokenInfo.Environment}`);
		res.status(200).send('OK');
	} catch (error) {
		logger.error(`WDF System: Error processing session: ${error.message}`);
		res.status(500).send('Internal Server Error');
	}
});

router.delete('/wdf/v1/rooms/MainJDM/session', rateLimitMiddleware, validator, async (req, res) => {
	const authorization = req.headers['authorization'];
	const token = authorization.substring(7, 257);
	const profileKey = `userProfileData:${token}`;
	
	try {
		// Get profile data to find the profileId
		const profileDataRedis = await client.get(profileKey);
		if (!profileDataRedis) {
			logger.error(`WDF System: Error Session Delete WDF: Profile data not found`);
			return res.status(404).json({
				status: 404,
				error: 'Not Found'
			});
		}
		
		const userProfile = JSON.parse(profileDataRedis);
		const profileId = userProfile.profileId;
		const userName = userProfile.name;
		
		// Delete the session using just the profileId as the key
		const sessionKey = `${profileId}-WDF`;
		const result = await client.del(sessionKey);
		
		if (result === 0) {
			logger.error(`WDF System: Error Session Delete WDF: Session not found for profileId ${profileId}`);
			return res.status(404).json({
				status: 404,
				error: 'Session not found'
			});
		}
		
		logger.info(`WDF System: WDF Session deleted for user ${userName}`);
		res.status(200).send('OK');
	} catch (error) {
		logger.error(`WDF System: Error processing session deletion: ${error.message}`);
		res.status(500).send('Internal Server Error');
	}
});

// Optional helper to check if a session is active
async function isSessionActive(profileId) {
	try {
		const sessionKey = `${profileId}-WDF`;
		const sessionData = await client.get(sessionKey);
		
		if (!sessionData) {
			return false;
		}
		
		const session = JSON.parse(sessionData);
		return session.isSessionActive === true;
	} catch (error) {
		logger.error(`WDF System: Error checking session status: ${error.message}`);
		return false;
	}
}

// Optional helper to get user profile data from an active session
async function getActiveSessionData(profileId) {
	try {
		const sessionKey = `${profileId}-WDF`;
		const sessionData = await client.get(sessionKey);
		
		if (!sessionData) {
			return null;
		}
		
		return JSON.parse(sessionData);
	} catch (error) {
		logger.error(`WDF System: Error fetching session data: ${error.message}`);
		return null;
	}
}
/// End Module Sessions

///Module Current Connected Users

router.get('/wdf/v1/rooms/MainJDM/ccu',  async (req, res) => {
	try {
		res.status(200).send(`${ccu}`);
	} catch (error) {
		logger.error(`WDF System: Error retrieving CCU: ${error.message}`);
		res.status(500).send('Internal Server Error');
	}
});
///Module Current Connected Users

/// TO DO

router.get('/wdf/v1/rooms/MainJDM/online-rank-widget', (req, res) => {
	res.json({
		"currentSeasonEndTime": 1723413600,
		"seasonNumber": 126,
		"currentSeasonDancerCount": 8738,
		"previousSeasonWinner": {
		},
		"__class": "OnlineRankWidgetInfo"
	})
});

router.get('/wdf/v1/rooms/MainJDM/session-recap', (req, res) => {
	res.json({
		"uniquePlayerCount": ccu,
		"countries": [],
		"lb": [],
		"__class": "SessionRecapInfo"
	})
});


router.get('/wdf/v1/rooms/MainJDM/newsfeed',  (req, res) => {
	res.json({
		"__class": "NewsfeedList",
		"entries": []
	});
});
/// TO DO
///Happy Hours
router.get('/wdf/v1/rooms/MainJDM/next-happyhours',  (req, res) => {
	const currentTime = Date.now() / 1000;
	res.json({
		"__class": "HappyHoursInfo",
		"start": currentTime,
		"end": currentTime + 14400,
		"running": true
	});
});
///Happy Hours

module.exports = {
	router,
	router2
};
