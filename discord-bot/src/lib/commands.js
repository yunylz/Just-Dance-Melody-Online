// External modules
const { Client, Collection, REST, Routes } = require("discord.js");
const fs = require("node:fs");
const path = require("node:path");

// Internal modules
const logger = require("./logger").createLogger({ service: "commands" });

/**
 * Load all commands into a collection.
 * Commands starting with an underscore (_) are ignored.
 * @param {Client} client
 * @param {Object} config
 */
const init = (client, config) => {
    client.commands = new Collection();

    const commandsFolderPath = `${global.root}/commands`;
    const commandFiles = fs.readdirSync(commandsFolderPath).filter(f => f.endsWith(".js") && !f.startsWith("_"));

    for (const file of commandFiles) {
        const filePath = path.join(commandsFolderPath, file);
        const command = require(filePath);

        if ("data" in command && "execute" in command) {
            client.commands.set(command.data.name, command);
        } else {
            logger.warn(`Command ${file} is missing either data or execute. Please look into it.`);
        }
    }
};

/**
 * Register all slash commands to Discord's API
 * @param {Client} client 
 * @param {Object} config 
 */
const registerCommands = async (client, config) => {
    const rest = new REST().setToken(config.BOT.TOKEN);

    const allCommands = Array.from(client.commands.values());

    // filter commands
    const publicCommands = allCommands
        .filter(cmd => !cmd.developersOnly)
        .map(cmd => cmd.data.toJSON());

    const devCommands = allCommands
        .filter(cmd => cmd.developersOnly)
        .map(cmd => cmd.data.toJSON());

    // register public slash commands (global)
    try {
        await rest.put(Routes.applicationCommands(config.BOT.CLIENT_ID), {
            body: publicCommands
        });
        logger.info(`Successfully registered ${publicCommands.length} public commands.`);
    } catch (error) {
        logger.error(`Failed to register public commands: ${error}`);
    }

    // register dev slash commands (guild only)
    try {
        await rest.put(Routes.applicationGuildCommands(config.BOT.CLIENT_ID, config.BOT.GUILD_ID), {
            body: devCommands
        });
        logger.info(`Successfully registered ${devCommands.length} dev commands.`);
    } catch (error) {
        logger.error(`Failed to register dev commands: ${error}`);
    }
};

module.exports = {
    init,
    registerCommands
};