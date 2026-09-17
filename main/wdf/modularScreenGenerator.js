const screenConfig = require('./screenConfig');
const MapSelector = require('./mapSelector');
const logger = require("../logger/logger"); // Assuming you have a logger

class ModularScreenGenerator {
	constructor() {
		this.mapSelector = new MapSelector();
		this.config = screenConfig;
	}

	selectTheme() {
		const random = Math.random() * 100;
		let cumulative = 0;

		for (const [theme, config] of Object.entries(this.config)) {
			if (theme === 'bannedMaps' || theme === 'screenDurations') continue;
			
			cumulative += config.probability;
			if (random <= cumulative) {
				return theme;
			}
		}

		
		return Object.keys(this.config).find(key => 
			key !== 'bannedMaps' && key !== 'screenDurations'
		);
	}

	selectPlaylistType(theme) {
		const themeConfig = this.config[theme];
		const playlistKey = theme === 'vote' ? 'votePlaylist' : 'tournamentPlaylist';
		const playlists = themeConfig[playlistKey];

		const random = Math.random() * 100;
		let cumulative = 0;

		for (const [playlistName, playlistConfig] of Object.entries(playlists)) {
			cumulative += playlistConfig.probability;
			if (random <= cumulative) {
				return { name: playlistName, config: playlistConfig };
			}
		}

		const firstPlaylist = Object.keys(playlists)[0];
		return { name: firstPlaylist, config: playlists[firstPlaylist] };
	}

	
	async generateTournamentScreens(startTime, playlistConfig) {
		try {
			const selectedMaps = await this.mapSelector.selectMaps(
				playlistConfig.mapNameRules,
				playlistConfig.playlistSize,
				this.config.bannedMaps
			);

			const screens = [];
			let currentTime = startTime;

			selectedMaps.forEach((map, index) => {
				// t presentation screen
				screens.push({
					__class: "Screen",
					type: "tournament-presentation",
					startTime: currentTime,
					endTime: currentTime + this.config.screenDurations["tournament-presentation"],
					theme: "tournament",
					mapName: map.mapName,
					tournamentInfo: {
						__class: "TournamentScreenInfo",
						tournamentType: playlistConfig.tournamentType,
						tournamentLogo: playlistConfig.tournamentLogo,
						roundNumber: index + 1,
						playListSize: playlistConfig.playlistSize,
						rewards: playlistConfig.rewards
					},
					schedule: this.generateSchedule("JD21RegularTournament", currentTime)
				});
				currentTime += this.config.screenDurations["tournament-presentation"];

				// t lobby screen
				screens.push({
					__class: "Screen",
					type: "tournament-lobby",
					startTime: currentTime,
					endTime: currentTime + this.config.screenDurations["tournament-lobby"],
					theme: "tournament",
					mapName: map.mapName,
					tournamentInfo: {
						__class: "TournamentScreenInfo",
						tournamentType: playlistConfig.tournamentType,
						tournamentLogo: playlistConfig.tournamentLogo,
						roundNumber: index + 1,
						playListSize: playlistConfig.playlistSize,
						rewards: playlistConfig.rewards
					},
					schedule: this.generateSchedule("JD21RegularTournament", currentTime)
				});
				currentTime += this.config.screenDurations["tournament-lobby"];

				// In-game 
				screens.push({
					__class: "Screen",
					type: "in-game",
					startTime: currentTime,
					endTime: currentTime + map.mapLength,
					theme: "tournament",
					mapName: map.mapName,
					schedule: this.generateSchedule("JD21RegularTournament", currentTime)
				});
				currentTime += map.mapLength;

				// Waiting screen
				screens.push({
					__class: "Screen",
					type: "waiting-screen",
					startTime: currentTime,
					endTime: currentTime + this.config.screenDurations["waiting-screen"],
					theme: "tournament",
					mapName: map.mapName,
					waitingScreenInfo: {
						__class: "WaitingScreenInfo",
						getRecapTime: currentTime + 13
					},
					schedule: this.generateSchedule("JD21RegularTournament", currentTime)
				});
				currentTime += this.config.screenDurations["waiting-screen"];

				// t recap screeen
				screens.push({
					__class: "Screen",
					type: "tournament-recap",
					startTime: currentTime,
					endTime: currentTime + this.config.screenDurations["tournament-recap"],
					theme: "tournament",
					mapName: map.mapName,
					tournamentInfo: {
						__class: "TournamentScreenInfo",
						tournamentType: playlistConfig.tournamentType,
						tournamentLogo: playlistConfig.tournamentLogo,
						roundNumber: index + 1,
						playListSize: playlistConfig.playlistSize,
						rewards: playlistConfig.rewards
					},
					schedule: this.generateSchedule("JD21RegularTournament", currentTime)
				});
				currentTime += this.config.screenDurations["tournament-recap"];
			});

			logger.info(`WDF System: Tournament screens generated with maps: ${selectedMaps.map(map => map.mapName).join(', ')}`);

			return {
				__class: "ScreenList",
				screens: screens
			};

		} catch (error) {
			logger.error('WDF System: Error generating tournament screens:', error);
			throw error;
		}
	}

	async generateVoteScreens(startTime, playlistConfig) {
		try {
			const selectedMaps = await this.mapSelector.selectMaps(
				playlistConfig.mapNameRules,
				playlistConfig.playlistSize,
				this.config.bannedMaps
			);

			const voteConfig = this.config.screenDurations.vote;
			const voteScreen = {
				__class: 'Screen',
				type: 'vote',
				startTime: startTime,
				endTime: startTime + voteConfig.totalDuration,
				theme: 'vote',
				voteInfo: {
					__class: 'VoteScreenInfo',
					voteStartTime: startTime,
					voteEndTime: startTime + voteConfig.voteDuration,
					voteResultFetchTime: startTime + voteConfig.voteDuration + (2 * voteConfig.waitBeforeVoteCompute),
					voteOptions: selectedMaps.map(map => map.mapName)
				},
				schedule: this.generateSchedule("MapVote", startTime)
			};

			logger.info(`WDF System: Vote screens generated with maps: ${selectedMaps.map(map => map.mapName).join(', ')}`);

			return {
				__class: "ScreenList",
				screens: [voteScreen]
			};

		} catch (error) {
			logger.error(error,'WDF System: Error generating vote screens:');
			throw error;
		}
	}


	async generateFinalVoteScreens(winnerMapName, previousScreenEndTime) {
		try {
			const mapLength = await this.mapSelector.getMapLength(winnerMapName);
			
			let currentTime = previousScreenEndTime;

			const screens = [
				{
					__class: 'Screen',
					type: 'vote-lobby',
					startTime: currentTime,
					endTime: currentTime + this.config.screenDurations["vote-lobby"],
					theme: 'vote',
					mapName: winnerMapName,
					schedule: this.generateSchedule("MapVote", currentTime)
				}
			];
			currentTime += this.config.screenDurations["vote-lobby"];

			screens.push({
				__class: 'Screen',
				type: 'in-game',
				startTime: currentTime,
				endTime: currentTime + mapLength,
				theme: 'vote',
				mapName: winnerMapName,
				schedule: this.generateSchedule("MapVote", currentTime)
			});
			currentTime += mapLength;

			screens.push({
				__class: 'Screen',
				type: 'waiting-screen',
				startTime: currentTime,
				endTime: currentTime + this.config.screenDurations["waiting-screen"],
				theme: 'vote',
				mapName: winnerMapName,
				waitingScreenInfo: {
					__class: 'WaitingScreenInfo',
					getRecapTime: currentTime + this.config.screenDurations["waiting-screen"] - 7
				},
				schedule: this.generateSchedule("MapVote", currentTime)
			});
			currentTime += this.config.screenDurations["waiting-screen"];

			screens.push({
				__class: 'Screen',
				type: 'vote-recap',
				startTime: currentTime,
				endTime: currentTime + this.config.screenDurations["vote-recap"],
				theme: 'vote',
				mapName: winnerMapName,
				schedule: this.generateSchedule("MapVote", currentTime)
			});

			logger.info(`WDF System: Final vote screens generated for winner: ${winnerMapName}`);

			return screens;

		} catch (error) {
			logger.error(error,'WDF System: Error generating final vote screens:');
			throw error;
		}
	}

	generateSchedule(theme, currentTime) {
		return {
			type: "probability",
			theme: theme,
			occurance: {
				next: currentTime + 10000,
				prev: null
			}
		};
	}


	async initializeScreens(startTime = null,isWeeklyScheduled=null) {
		try {
			logger.info('WDF System: Initializing modular screens...');
			const initialStartTime = startTime || (Date.now() / 1000)
			const isWeeklyPrepared = isWeeklyScheduled || false
			let selectedTheme
			let playlistInfo
			if (isWeeklyPrepared===true){
				selectedTheme='tournament'
				playlistInfo = {
					name: 'weeklyTournament',
					config: this.config.tournament.tournamentPlaylist.weeklyTournament
				};
			} else {
				selectedTheme=this.selectTheme();
				playlistInfo=this.selectPlaylistType(selectedTheme);
			}
			
			
			logger.info(`WDF System: Selected theme: ${selectedTheme}, playlist: ${playlistInfo.name}`);

			let initialScreen;
			if (selectedTheme === 'vote') {
				initialScreen = await this.generateVoteScreens(initialStartTime, playlistInfo.config);
			} else if (selectedTheme === 'tournament') {
				initialScreen = await this.generateTournamentScreens(initialStartTime, playlistInfo.config);
			}

			if (initialScreen) {
				return initialScreen;
			} else {
				throw new Error('Initial screen was not generated');
			}

		} catch (error) {
			logger.error(error,'WDF System: Error initializing screens:');
			throw error;
		}
	}

	updateConfig(newConfig) {
		this.config = { ...this.config, ...newConfig };
		logger.info('WDF System: Configuration updated');
	}


	getConfig() {
		return this.config;
	}
}

module.exports = ModularScreenGenerator;
