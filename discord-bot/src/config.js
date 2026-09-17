module.exports = {
    // Bot essentials
    BOT: {
        TOKEN: process.env.DISCORD_BOT_TOKEN || "",
        CLIENT_ID: process.env.DISCORD_APP_CLIENT_ID || "",
        CLIENT_SECRET: process.env.DISCORD_APP_SECRET || "",
        GUILD_ID: process.env.DISCORD_GUILD_ID || "" // Development guild, private commands will be registered here
    },
    ROLES: {
        PATREON: process.env.DISCORD_PATREON_ROLE_ID || "",
        WDF_AMERICA: process.env.DISCORD_WDF_AMERICA_ROLE_ID || "",
        WDF_EUROPE: process.env.DISCORD_WDF_EUROPE_ROLE_ID || "",
        WDF_ASIA: process.env.DISCORD_WDF_ASIA_ROLE_ID || ""
    }
};