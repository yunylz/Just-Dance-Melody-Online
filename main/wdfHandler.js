const express = require('express');
const axios = require('axios');
const http = require('http');
const app = express();
const PORT = 8473; // Random port for HTTP

// Middleware to parse JSON
app.use(express.json());

// Global variable to track weekly scheduling
let isWeeklyScheduled = false;

async function executeOperation(screen) {
	try {
		switch (screen.type) {
			case 'tournament-recap':
				if (screen.tournamentInfo.roundNumber === screen.tournamentInfo.playListSize) {
					const responseScreen = await axios.post('http://127.0.0.1:312/wdfHandler/genNewScreen', {
						endTimeScreen: screen.endTime,
						isWeeklyScheduled
					});
					console.log(`${responseScreen.data.message}`);
					if (isWeeklyScheduled) {
						console.log("Tournament Weekly Enabled!");
						isWeeklyScheduled = false;
					}
					isWeeklyScheduled = false;
				}
				break; // Add break here to avoid falling through

			case 'vote-recap':
				const responseScreenVoteRecap = await axios.post('http://127.0.0.1:312/wdfHandler/genNewScreen', {
					endTimeScreen: screen.endTime,
					isWeeklyScheduled
				});
				if (isWeeklyScheduled) {
						console.log("Tournament Weekly Enabled!");
						isWeeklyScheduled = false;
				}
				isWeeklyScheduled = false;
				break; // Add break here to avoid falling through

			case 'vote':
				const responseVote = await axios.post('http://127.0.0.1:312/wdfHandler/startVote', {
					voteOptionsBody: screen.voteInfo.voteOptions,
					VoteEndTimeScreen: screen.voteInfo.voteEndTime,
					screenStartTime: screen.startTime,
					ScreenEndTime: screen.endTime
				});
				break;
			case 'in-game':
				console.log(`inGame startTimeScreen: ${screen.startTime}`);
				const responseInGame = await axios.post('http://127.0.0.1:312/wdfHandler/inGameCompute', {
					startTimeScreen: screen.startTime
				});
				console.log(`${responseInGame.data.message}`);
				break;
			case 'waiting-screen':
				const responseRecap = await axios.get('http://127.0.0.1:312/wdfHandler/calculateScoreRecap');
				console.log(`${responseRecap.data.message}`);
				const updateCCU = await axios.get('http://127.0.0.1:312/wdfHandler/getCCU');
				console.log(`${updateCCU.data.message}`);
				break;
			case 'vote-lobby':
				const responseVoteLobby = await axios.get('http://127.0.0.1:312/wdfHandler/setVoteMode');
				console.log(`${responseVoteLobby.data.message}`);
				break;
			case 'tournament-lobby':
				const responseTournamentLobby = await axios.get('http://127.0.0.1:312/wdfHandler/setTournamentMode');
				console.log(`${responseTournamentLobby.data.message}`);
				break;
			default:
				console.log(`No operation defined for screen type: ${screen.type}`);
		}
	} catch (error) {
		console.error(`Error executing operation for screen type: ${screen.type}, ${error.message}`);
	}
}

async function scheduleOperations() {
	try {
		const response = await axios.get('http://127.0.0.1:312/wdfHandler/getScreen');
		const screenList = response.data; 

		if (screenList.screens.length === 1) {

			const screen = screenList.screens[0];
			const currentTime = Date.now() / 1000; 
			const timeUntilEnd = screen.endTime - currentTime; 

			if (timeUntilEnd > 0) {

				setTimeout(scheduleOperations, timeUntilEnd * 1000);
			} else {
	
				setTimeout(scheduleOperations, 1000);
			}

			console.log(`Executing operation for single screen type: ${screen.type}`);
			await executeOperation(screen);

		} else {

			const lastEndTime = Math.max(...screenList.screens.map(screen => screen.endTime));
			console.log(`Last endTime detected: ${lastEndTime}`); 

			screenList.screens.forEach(screen => {
				const currentTime = Date.now() / 1000; 
				const timeUntilStart = screen.startTime - currentTime; 
				const timeUntilEnd = screen.endTime - currentTime; 

				if (timeUntilStart > 0) {
					setTimeout(async () => {
						console.log(`Executing operation for screen type: ${screen.type}`);
						await executeOperation(screen);

						if (screen.endTime === lastEndTime) {
							console.log('New screen consulted'); 
							setTimeout(scheduleOperations, 1000);
						}
					}, timeUntilStart * 1000);
				} else {
					console.log(`Executing operation for screen type: ${screen.type}`);
					executeOperation(screen);

					if (screen.endTime === lastEndTime) {
						console.log('New screen consulted'); 
						setTimeout(scheduleOperations, 1000);
					}
				}
			});
		}
	} catch (error) {
		console.error('Error fetching screen list:', error.message);
	}
}

app.post('/wdf/handler/enableWeekly', (req, res) => {
	try {
		isWeeklyScheduled = true;
		console.log('Weekly scheduling enabled');
		
		res.status(200).json({
			success: true,
			message: 'Weekly scheduling enabled successfully',
			isWeeklyScheduled: isWeeklyScheduled
		});
	} catch (error) {
		console.error('Error enabling weekly scheduling:', error.message);
		res.status(500).json({
			success: false,
			message: 'Failed to enable weekly scheduling',
			error: error.message
		});
	}
});
app.get('/wdf/handler/weeklyStatus', (req, res) => {
	res.status(200).json({
		isWeeklyScheduled: isWeeklyScheduled
	});
});

// Start the Express server
const handlerServer = http.createServer(app);

handlerServer.listen(PORT, () => {
  console.log(`WDF scheduler running at port ${PORT}`);
  scheduleOperations();
});