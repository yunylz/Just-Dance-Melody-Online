const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const readline = require('readline');

const MAX_SCORE = 13333;
const IN_GAME_SCORE_INTERVAL = 5000;

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

const defaultBotsConfig = [
	{ name: '[C:FFFFC2CD]c0llydoll[icon:favorite]', avatar: 1752, portraitBorder: 176, points: 461488, skill: 'hard', limit: 0.93 },
	{ name: 'flop-hacker', avatar: 182, portraitBorder: 50, points: 320000, skill: 'medium', limit: 0.7 },
	{ name: 'Mario', avatar: 260, portraitBorder: 162,points: 120300, skill: 'easy', limit: 0.3 },
];

const skillLimits = {
	easy: { min: 0.2, max: 0.4 },
	medium: { min: 0.5, max: 0.8 },
	hard: { min: 0.88, max: 0.94 }
};

const bots = [];
let intervalHandles = [];

// --- Create a bot object ---
function createBot({ name, avatar,portraitBorder, points, skill }) {
	const guid = uuidv4();
	const { min, max } = skillLimits[skill];
	const targetScore = parseFloat((min + Math.random() * (max - min)).toFixed(6));
	return {
		guid,
		name,
		avatar,
		portraitBorder,
		points,
		skill,
		limit: max,
		targetScore,
		currentScore: 0.0,
		startTime: null,
		endTime: null
	};
}

function createRandomBot(index) {
	const skillOptions = ['easy', 'medium', 'hard'];
	const skill = skillOptions[Math.floor(Math.random() * skillOptions.length)];

	return createBot({
		name: `BotTest-${index + 1}`,
		avatar: 1000 + Math.floor(Math.random() * 556),
		points: Math.floor(Math.random() * 60001),
		skill
	});
}

async function registerBot(bot) {
	try {
		await axios.post('http://127.0.0.1:777/wdf/v1/rooms/MainJDM/session', {}, {
			headers: {
				authorization: `Bot_v1 ${bot.guid}`,
				'wdf-key-azure': 'iVC03NEB6D09OSn2acbU3dTNOmawzKsv',
				'x-jd-name': bot.name,
				'x-jd-avatar': bot.avatar,
				'x-jd-points': bot.points,
				'x-jd-portraitborder': bot.portraitBorder,
				'x-jd-skill': bot.skill === 'easy' ? 101 : bot.skill === 'medium' ? 202 : 303,
				'x-skuid': 'jd2022-nx-all'
			}
		});
		console.log(` Bot registered: ${bot.name} portraitTest ${bot.portraitBorder} `);
	} catch (err) {
		console.error(`Failed to register bot ${bot.name}:`, err.message);
	}
}


async function executeOperation(screen) {
	if (screen.type !== 'in-game') return;

	const theme = screen.theme;
	const endTime = screen.endTime * 1000;
	const startTime = screen.startTime * 1000;
	const now = Date.now();
	const url = theme === 'vote'
		? 'http://127.0.0.1:777/wdf/v1/rooms/MainJDM/themes/vote/update-scores'
		: theme === 'tournament'
			? 'http://127.0.0.1:777/wdf/v1/rooms/MainJDM/themes/tournament/update-scores'
			: null;

	if (!url) return;

	console.log(`🎮 In-game screen started (theme: ${theme})`);

	// Update all bots with timing info
	bots.forEach(bot => {
		bot.startTime = startTime;
		bot.endTime = endTime;
		bot.currentScore = 0.0;
	});

	const interval = setInterval(async () => {
		const now = Date.now();

		if (now >= endTime) {
			clearInterval(interval);
			intervalHandles = [];
			printRecap();
			return;
		}

		const totalDuration = endTime - startTime;
		const elapsed = now - startTime;

		for (const bot of bots) {
			const progressRatio = Math.min(elapsed / totalDuration, 1.0);
			const newScore = parseFloat((progressRatio * bot.targetScore).toFixed(6));

			// Avoid sending the same value again
			if (newScore > bot.currentScore) {
				bot.currentScore = newScore;

				try {
					await axios.post(url, { score: newScore }, {
						headers: {
							authorization: `Bot_v1 ${bot.guid}`,
							'wdf-key-azure': 'iVC03NEB6D09OSn2acbU3dTNOmawzKsv',
							'x-jd-name': bot.name,
							'x-jd-avatar': bot.avatar,
							'x-jd-points': bot.points,
							'x-jd-portraitborder': bot.portraitBorder
						}
					});
					console.log(`⬆️  ${bot.name} updated score: ${newScore} ${bot.portraitBorder}`);
				} catch (err) {
					console.error(`❌ ${bot.name} failed to send score:`, err.message);
				}
			}
		}
	}, IN_GAME_SCORE_INTERVAL);

	intervalHandles.push(interval);
}


function printRecap() {
	console.log(`\n Round Recap`);
	const recap = bots
		.map(bot => {
			const finalScore = Math.round(bot.currentScore * MAX_SCORE);
			return { name: bot.name, score: finalScore };
		})
		.sort((a, b) => b.score - a.score);

	recap.forEach((bot, index) => {
		console.log(`${index + 1}. ${bot.name} = ${bot.score}`);
	});
	console.log('-------------------------------------\n');
}
async function scheduleOperations() {
	try {
		const response = await axios.get('http://127.0.0.1:312/wdfHandler/getScreen');
		const screenList = response.data;

		if (screenList.screens.length === 1) {
			const screen = screenList.screens[0];
			const now = Date.now() / 1000;
			const timeUntilEnd = screen.endTime - now;

			if (timeUntilEnd > 0) {
				setTimeout(scheduleOperations, timeUntilEnd * 1000);
			} else {
				setTimeout(scheduleOperations, 1000);
			}
			await executeOperation(screen);
		} else {
			const lastEndTime = Math.max(...screenList.screens.map(s => s.endTime));

			screenList.screens.forEach(screen => {
				const now = Date.now() / 1000;
				const timeUntilStart = screen.startTime - now;
				const timeUntilEnd = screen.endTime - now;

				if (timeUntilStart > 0) {
					setTimeout(async () => {
						await executeOperation(screen);
						if (screen.endTime === lastEndTime) {
							setTimeout(scheduleOperations, 1000);
						}
					}, timeUntilStart * 1000);
				} else {
					executeOperation(screen);
					if (screen.endTime === lastEndTime) {
						setTimeout(scheduleOperations, 1000);
					}
				}
			});
		}
	} catch (err) {
		console.error(' Error fetching screen:', err.message);
		setTimeout(scheduleOperations, 5000);
	}
}

function setupBots() {
	// Add default bots
	defaultBotsConfig.forEach(config => bots.push(createBot(config)));

	// Ask if user wants random bots
	rl.question('💬 Do you want to add random bots? (y/n): ', answer => {
		if (answer.trim().toLowerCase() === 'y') {
			rl.question('💬 How many random bots?: ', async numberStr => {
				const count = parseInt(numberStr.trim(), 10);
				if (isNaN(count) || count < 1) {
					console.log('❌ Invalid number.');
					rl.close();
					return;
				}

				for (let i = 0; i < count; i++) {
					const bot = createRandomBot(i);
					bots.push(bot);
				}

				await Promise.all(bots.map(registerBot));
				rl.close();
				scheduleOperations();
			});
		} else {
			Promise.all(bots.map(registerBot)).then(() => {
				rl.close();
				scheduleOperations();
			});
		}
	});
}

// Start the tool
setupBots();
