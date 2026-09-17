const path = require('path');
const fs = require('fs');
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

class MapSelector {
	constructor() {
		this.songsData = null;
		this.recentMaps = [];
	}

	async loadSongsData() {
		if (!this.songsData) {
			const filePath = path.join(__dirname, '../data/songdb/jdmelody-nx-patreon.json');
			this.songsData = await readJsonFile(filePath);
		}
		return this.songsData;
	}

	async filterMaps(mapNameRules, bannedMaps = []) {
		const songsData = await this.loadSongsData();
		let availableMaps = Object.values(songsData);

		if (mapNameRules.excludeBannedMaps && bannedMaps.length > 0) {
			availableMaps = availableMaps.filter(map => !bannedMaps.includes(map.mapName));
		}

		availableMaps = availableMaps.filter(map => !this.recentMaps.includes(map.mapName));


		if (mapNameRules.isPreselectedMaps && mapNameRules.preselectedMapNames.length > 0) {
			availableMaps = availableMaps.filter(map => 
				mapNameRules.preselectedMapNames.includes(map.mapName)
			);
		}


		if (mapNameRules.isJDVersionMap && mapNameRules.JDVersionMaps.length > 0) {
			availableMaps = availableMaps.filter(map => 
				mapNameRules.JDVersionMaps.includes(map.originalJDVersion)
			);
		}

		if (mapNameRules.isDifficultyOnly && mapNameRules.difficultyOnly.length > 0) {
			availableMaps = availableMaps.filter(map => 
				mapNameRules.difficultyOnly.includes(map.difficulty)
			);
		}

		if (mapNameRules.containsSpecificArtist && mapNameRules.specificArtist) {
			const artistSearch = mapNameRules.specificArtist.toLowerCase();
			availableMaps = availableMaps.filter(map => 
				map.artist.toLowerCase().includes(artistSearch)
			);
		}

		if (mapNameRules.isOnlyCoachCount && mapNameRules.coachCountOnly.length > 0) {
			availableMaps = availableMaps.filter(map => 
				mapNameRules.coachCountOnly.includes(map.coachCount)
			);
		}

		return availableMaps;
	}


	async selectRandomMaps(filteredMaps, count) {
		if (filteredMaps.length === 0) {
			throw new Error('No maps available after filtering');
		}

		const selectedMaps = [];
		const availableMaps = [...filteredMaps]; 
		for (let i = 0; i < count && availableMaps.length > 0; i++) {
			const randomIndex = Math.floor(Math.random() * availableMaps.length);
			const selectedMap = availableMaps[randomIndex];
			
			selectedMaps.push({
				mapName: selectedMap.mapName,
				mapLength: selectedMap.mapLength,
				artist: selectedMap.artist,
				difficulty: selectedMap.difficulty,
				coachCount: selectedMap.coachCount,
				originalJDVersion: selectedMap.originalJDVersion
			});


			availableMaps.splice(randomIndex, 1);
			this.recentMaps.push(selectedMap.mapName);
		}

		if (this.recentMaps.length > Object.keys(await this.loadSongsData()).length * 0.7) {
			this.recentMaps = this.recentMaps.slice(-Math.floor(Object.keys(await this.loadSongsData()).length * 0.3));
		}

		return selectedMaps;
	}


	async selectMaps(mapNameRules, playlistSize, bannedMaps = []) {
		try {
			const filteredMaps = await this.filterMaps(mapNameRules, bannedMaps);
			
			if (filteredMaps.length === 0) {
				this.recentMaps = [];
				const fallbackRules = {
					...mapNameRules,
					isRandomMaps: true,
					isPreselectedMaps: false,
					isJDVersionMap: false,
					isDifficultyOnly: false,
					containsSpecificArtist: false,
					isOnlyCoachCount: false
				};
				const fallbackMaps = await this.filterMaps(fallbackRules, bannedMaps);
				return this.selectRandomMaps(fallbackMaps, playlistSize);
			}

			return this.selectRandomMaps(filteredMaps, playlistSize);
		} catch (error) {
			throw new Error(`Map selection failed: ${error.message}`);
		}
	}


	resetRecentMaps() {
		this.recentMaps = [];
	}


	async getMapLength(mapName) {
		const songsData = await this.loadSongsData();
		return songsData[mapName]?.mapLength || 180; 
	}
}

module.exports = MapSelector;