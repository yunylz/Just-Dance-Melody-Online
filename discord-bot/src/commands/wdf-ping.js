// External modules
const { ChatInputCommandInteraction, Client, SlashCommandBuilder, MessageFlags } = require("discord.js");

// Internal modules
const config = require("../config");

// cooldowns per region (not user)
let pingCooldowns = {
    americas: 0,
    europe: 0,
    asia: 0
};
let COOLDOWN_TIME = 60 * 60 * 1000; // 1 hour cooldown

// Command
module.exports = {
    data: new SlashCommandBuilder()
    .setName("wdf-ping")
    .setDescription("Ping users to play WDF with you!")
    .addStringOption(option =>
        option.setName("region")
            .setDescription("Select the region for the role")
            .setRequired(true)
            .addChoices(
                { name: "The Americas", value: "americas" },
                { name: "Europe/Africa", value: "europe" },
                { name: "Asia/Oceania", value: "asia" }
            )
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
        let channelId = "1390010519511109662"; // wdf-talk

        if (interaction.channel.id !== channelId) {
            await interaction.reply({ content: `You can only use this command in the <#${channelId}> channel.`, flags: [MessageFlags.Ephemeral] });
            return;
        }

        const region = interaction.options.getString("region");

        let roleId;
        let regionName;
        switch (region) {
            case "americas":
                roleId = config.ROLES.WDF_AMERICA;
                regionName = "Americas";
                break;
            case "europe":
                roleId = config.ROLES.WDF_EUROPE;
                regionName = "Europe/Africa";
                break;
            case "asia":
                roleId = config.ROLES.WDF_ASIA;
                regionName = "Asia/Oceania";
                break;
            default:
                await interaction.reply({ content: "Invalid region selected.", flags: [MessageFlags.Ephemeral] });
                return;
        }

        const now = Date.now();
        if (now - pingCooldowns[region] < COOLDOWN_TIME) {
            const remainingTime = Math.ceil((COOLDOWN_TIME - (now - pingCooldowns[region])) / 1000);
            await interaction.reply({ content: `You must wait ${remainingTime} seconds before pinging this region again.`, flags: [MessageFlags.Ephemeral] });
            return;
        }

        pingCooldowns[region] = now;

        const roleMention = `<@&${roleId}>`;
        const userUsername = interaction.user.displayName;
        await interaction.reply({ content: `${userUsername.replaceAll(/@/g, '@\u200b')} is looking for players in the ${regionName} region to play World Dance Floor with!\n${roleMention}`, allowedMentions: { roles: [roleId] } });
    }
};