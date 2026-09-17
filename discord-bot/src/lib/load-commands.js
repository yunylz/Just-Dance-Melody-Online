const fs = require("node:fs");
const path = require("node:path");

// Load commands dynamically
const commandsPath = path.join(global.root, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(f => f.endsWith(".js"));

module.exports = async (client) => {
    var commandsForRegistration = [];

    for (const file of commandFiles) {
        const command = require(path.join(commandsPath, file));
        client.commands.set(command.data.name, command);
        commandsForRegistration.push({
            ...command.data.toJSON(),
            devOnly: command.developersOnly || false
        });
    }

    return commandsForRegistration;
};