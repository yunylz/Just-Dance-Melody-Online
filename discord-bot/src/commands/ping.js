// External modules
const { ChatInputCommandInteraction, Client, SlashCommandBuilder } = require("discord.js");

// Command
module.exports = {
    data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check the bot's latency"),
    developersOnly: false,
    /**
     * @param {Client} client
     * @param {ChatInputCommandInteraction} interaction
     */
    async execute(client, interaction) {
        const response = await interaction.reply({ 
            content: "Pinging...", 
            withResponse: true 
        });
        const sent = response.resource.message;
        
        const latency = sent.createdTimestamp - interaction.createdTimestamp;
        const apiLatency = Math.round(interaction.client.ws.ping);
        
        await interaction.editReply(
            `🏓 Pong!\n**Latency:** ${latency}ms\n**API Latency:** ${apiLatency}ms`
        );
    }
};