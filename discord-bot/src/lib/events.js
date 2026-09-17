// External modules
const axios = require("axios");
const { Client, Events } = require("discord.js");

// Internal modules
const config = require("../config");
const logger = require("./logger").createLogger({ service: "events" });

const UTILS_API_URL = process.env.UTILS_API_URL || "http://localhost:5442";

/**
 * Load all the main client events
 * @param {Client} client
 */
const init = (client) => {

    // ClientReady
    client.once(Events.ClientReady, (readyClient) => {
        logger.info(`Logged in as ${readyClient.user.tag}`);
    });


    // InteractionCreate
    client.on(Events.InteractionCreate, async (interaction) => {
        if (!interaction.isChatInputCommand()) return;

        const command = interaction.client.commands.get(interaction.commandName);

        if (!command) {
            logger.error(`Command ${interaction.commandName} was not found.`);
            return;
        }

        /*
        if (interaction.isAutocomplete()) {
            try {
                await command.autocomplete(interaction);
            } catch (error) {
                logger.error(`An error occurred while executing autocomplete for command ${interaction.commandName}:`, error);
            }
        }
        */

        try {
            await command.execute(client, interaction);
        } catch (error) {
            logger.error(`An error occurred while executing command ${interaction.commandName}:`, error);

            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: "There was an error while executing this command!", ephemeral: true });
            } else {
                await interaction.reply({ content: "There was an error while executing this command!", ephemeral: true });
            }
        }
    });


    // GuildMemberUpdate - Check for Patreon role changes
    client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
        const patreonRoleId = config.ROLES.PATREON;
        if (!patreonRoleId) return;

        const hadPatreon = oldMember.roles.cache.has(patreonRoleId);
        const hasPatreon = newMember.roles.cache.has(patreonRoleId);

        // Only proceed if Patreon role status changed
        if (hadPatreon === hasPatreon) return;

        try {
            await axios.post(`${UTILS_API_URL}/verification/patreon`, {
                discordId: newMember.id,
                isPatreon: hasPatreon
            });
            logger.info(`Updated Patreon status for ${newMember.user.tag}: ${hasPatreon}`);
        } catch (error) {
            // 404 means user not linked, which is fine
            if (error.response?.status !== 404) {
                logger.error(`Failed to update Patreon status for ${newMember.user.tag}:`, error.message);
            }
        }
    });


    // GuildMemberRemove - Unlink account when user leaves
    client.on(Events.GuildMemberRemove, async (member) => {
        try {
            await axios.post(`${UTILS_API_URL}/verification/unlink`, {
                discordId: member.id
            });
            logger.info(`Unlinked account for ${member.user.tag} (left server)`);
        } catch (error) {
            // 404 means user not linked, which is fine
            if (error.response?.status !== 404) {
                logger.error(`Failed to unlink account for ${member.user.tag}:`, error.message);
            }
        }
    });

};

module.exports = {
    init
};