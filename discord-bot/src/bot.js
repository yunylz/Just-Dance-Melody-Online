const project = require("../package.json");

// Set global data
global.root = __dirname;
global.project = project;

// Load dotenv file
const dotenv = require("dotenv").config({ quiet: true });
require("dotenv-expand").expand(dotenv);

// External modules
const async = require("async");
const { Client, GatewayIntentBits } = require("discord.js");

// Internal modules
const cache = require("./lib/cache");
const commands = require("./lib/commands");
const config = require("./config");
const events = require("./lib/events");
const logger = require("./lib/logger").createLogger({ service: global.project.name });

// Load everything and start the bot
async.waterfall(
    [
        // 1. Load config
        (callback) => {
            callback(null, config);
        },
        // 2. Load cache
        (config, callback) => {
            cache.init();
            callback(null, config);
        },
        // 3. Create bot client
        (config, callback) => {
            const client = new Client({
                intents: [
                    GatewayIntentBits.Guilds,
                    GatewayIntentBits.GuildMessages,
                    GatewayIntentBits.MessageContent,
                    GatewayIntentBits.GuildMembers,
                ]
            });
            callback(null, client, config);
        },
        // 4. Load events
        (client, config, callback) => {
            events.init(client);
            callback(null, client, config);
        },
        // 5. Load commands
        (client, config, callback) => {
            commands.init(client, config);
            callback(null, client, config);
        },
        // 6. Register slash commands
        (client, config, callback) => {
            commands.registerCommands(client, config);
            callback(null, client, config);
        },
        // 7. Log in bot
        (client, config, callback) => {
            client.login(config.BOT.TOKEN);
            callback(null);
        }
    ],
    (err) => {
        if (err) {
            logger.error("An error occured while starting the bot:", err);
            process.exit(1);
        }
    }
);