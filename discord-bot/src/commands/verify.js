// External modules
const axios = require("axios");
const { ChatInputCommandInteraction, Client, MessageFlags, SlashCommandBuilder } = require("discord.js");

// Internal modules
const config = require("../config");

const UTILS_API_URL = process.env.UTILS_API_URL || "http://localhost:5442";

// Command
module.exports = {
    data: new SlashCommandBuilder()
        .setName("verify")
        .setDescription("Link your Discord account to your JDMO profile")
        .addStringOption(option =>
            option.setName("code")
                .setDescription("Your 8-character verification code from the game")
                .setRequired(true)
                .setMinLength(8)
                .setMaxLength(8)
        ),
    developersOnly: false,
    /**
     * @param {Client} client
     * @param {ChatInputCommandInteraction} interaction
     */
    async execute(client, interaction) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const code = interaction.options.getString("code").toUpperCase();
        const discordId = interaction.user.id;

        // Check if user has Patreon role
        const member = interaction.member;
        const isPatreon = member.roles.cache.has(config.ROLES.PATREON);

        try {
            const response = await axios.get(`${UTILS_API_URL}/verification/verify`, {
                params: {
                    discordId,
                    isPatreon: isPatreon.toString(),
                    code
                }
            });

            if (response.data.success) {
                const username = response.data.username ? ` (**${response.data.username}**)` : "";
                await interaction.editReply({
                    content: `✅ **Verification successful!**\n\nYour Discord account has been linked to your JDMO profile${username}.\n${isPatreon ? "🎉 Patreon benefits have been activated!" : ""}`
                });
            }
        } catch (error) {
            let errorMessage = "An error occurred during verification.";

            if (error.response) {
                const { status, data } = error.response;

                switch (status) {
                    case 400:
                        if (data.error?.includes("already linked")) {
                            errorMessage = "❌ This Discord account is already linked to another JDMO profile.";
                        } else {
                            errorMessage = `❌ ${data.error || "Invalid request."}`;
                        }
                        break;
                    case 404:
                        errorMessage = "❌ Invalid or expired verification code. Please get a new code from the game.";
                        break;
                    case 500:
                        errorMessage = "❌ Server error. Please try again later.";
                        break;
                    default:
                        errorMessage = `❌ ${data.error || "Unknown error occurred."}`;
                }
            }

            await interaction.editReply({ content: errorMessage });
        }
    }
};