// External modules
const { ChatInputCommandInteraction, Client, SlashCommandBuilder } = require("discord.js");

// Command
module.exports = {
    data: new SlashCommandBuilder()
    .setName("_defaultName")
    .setDescription("_defaultDescription")
    .addStringOption(option =>
        option.setName("_optionName")
            .setDescription("_optionDescription")
            .setRequired(true)
    ),
    developersOnly: false,
    /**
     * @param {Client} client
     * @param {ChatInputCommandInteraction} interaction
     */
    async execute(client, interaction) {
        /*
            This is where the command code will go.
        */
    }
};