const express = require("express");

const router = express.Router();
const User = require("../lib/models/User");
const config = require("../config");


async function sendVerificationLog(type, data) {
    if (!config.WEBHOOKS.VERIFICATION) return;

    const colors = {
        success: 0x57F287,  // Green
        failure: 0xED4245,  // Red
        info: 0x5865F2      // Blurple
    };

    const embed = {
        title: `Verification ${type.charAt(0).toUpperCase() + type.slice(1)}`,
        color: colors[type] || colors.info,
        fields: Object.entries(data).map(([key, value]) => ({
            name: key,
            value: String(value),
            inline: true
        })),
        timestamp: new Date().toISOString()
    };

    try {
        await fetch(config.WEBHOOKS.VERIFICATION, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ embeds: [embed] })
        });
    } catch (err) {
        console.error("Failed to send verification webhook:", err);
    }
}


router.get("/code", async (req, res) => {
    const { profileId } = req.query;

    if (!profileId) {
        return res.status(400).json({ error: "Missing profileId query parameter" });
    }

    try {
        const user = await User.findOne({ profileId });

        if (!user) {
            return res.status(404).json({ error: "User not found" });
        }

        let code = user.verificationCode;
        let discordId = user.discordId;

        if (!code && !discordId) {
            code = await generateUniqueCode();
            user.verificationCode = code;
            await user.save();
            await sendVerificationLog("info", {
                "Action": "Code Generated",
                "Profile ID": profileId,
                "Username": user.userName
            });
        }

        if (discordId && code) {
            user.verificationCode = null;
            await user.save();
        }

        return res.json({ code, status: user.discordId ? "linked" : "code" });
    } catch (err) {
        return res.status(500).json({ error: "Internal server error" });
    }
});

router.get("/verify", async (req, res) => {
    const { discordId, isPatreon, code } = req.query;

    if (!code || !discordId || !isPatreon) {
        return res.status(400).json({ error: "Missing required query parameters" });
    }

    try {
        // find user by code
        const user = await User.findOne({ verificationCode: code });

        if (!user) {
            await sendVerificationLog("failure", {
                "Action": "Verification Failed",
                "Reason": "Invalid or expired code",
                "Code": code,
                "Discord ID": discordId
            });
            return res.status(404).json({ error: "Invalid or expired verification code" });
        }

        // Check if Discord ID is already linked to another account of the same platform type
        const existingDiscordUser = await User.findOne({ 
            discordId, 
            platformType: user.platformType,
            profileId: { $ne: user.profileId } 
        });
        if (existingDiscordUser) {
            await sendVerificationLog("failure", {
                "Action": "Verification Failed",
                "Reason": "Discord ID already linked to same platform",
                "Profile ID": user.profileId,
                "Platform": user.platformType,
                "Discord ID": discordId,
                "Linked To": existingDiscordUser.userName
            });
            return res.status(400).json({ error: `This Discord account is already linked to another profile on this platform` });
        }

        user.discordId = discordId;
        user.isPatreon = isPatreon === "true";
        user.verificationCode = null;
        await user.save();

        await sendVerificationLog("success", {
            "Action": "Verification Success",
            "Profile ID": user.profileId,
            "Username": user.userName,
            "Platform": user.platformType,
            "Discord ID": discordId,
            "Patreon": isPatreon
        });

        return res.json({ success: true, username: user.userName });
    } catch (err) {
        return res.status(500).json({ error: "Internal server error" });
    }
});

// Update Patreon status by Discord ID (updates ALL linked accounts)
router.post("/patreon", async (req, res) => {
    const { discordId, isPatreon } = req.body;

    if (!discordId || isPatreon === undefined) {
        return res.status(400).json({ error: "Missing required parameters" });
    }

    try {
        const users = await User.find({ discordId });

        if (!users || users.length === 0) {
            return res.status(404).json({ error: "No users found with this Discord ID" });
        }

        const newPatreonStatus = isPatreon === true || isPatreon === "true";
        const updatedUsers = [];

        for (const user of users) {
            const previousStatus = user.isPatreon;
            user.isPatreon = newPatreonStatus;
            await user.save();
            updatedUsers.push({ username: user.userName, platform: user.platformType });

            await sendVerificationLog("info", {
                "Action": "Patreon Status Updated",
                "Username": user.userName,
                "Platform": user.platformType,
                "Discord ID": discordId,
                "Previous": previousStatus ? "Yes" : "No",
                "Current": user.isPatreon ? "Yes" : "No"
            });
        }

        return res.json({ 
            success: true, 
            count: users.length,
            users: updatedUsers, 
            isPatreon: newPatreonStatus 
        });
    } catch (err) {
        return res.status(500).json({ error: "Internal server error" });
    }
});

// Unlink Discord accounts (when user leaves server) - unlinks ALL accounts
router.post("/unlink", async (req, res) => {
    const { discordId } = req.body;

    if (!discordId) {
        return res.status(400).json({ error: "Missing discordId" });
    }

    try {
        const users = await User.find({ discordId });

        if (!users || users.length === 0) {
            return res.status(404).json({ error: "No users found with this Discord ID" });
        }

        const unlinkedUsers = [];

        for (const user of users) {
            const username = user.userName;
            const platform = user.platformType;
            user.discordId = null;
            user.isPatreon = false;
            await user.save();
            unlinkedUsers.push({ username, platform });

            await sendVerificationLog("info", {
                "Action": "Account Unlinked",
                "Reason": "User left server",
                "Username": username,
                "Platform": platform,
                "Discord ID": discordId
            });
        }

        return res.json({ success: true, count: users.length, users: unlinkedUsers });
    } catch (err) {
        return res.status(500).json({ error: "Internal server error" });
    }
});


module.exports = router;


async function generateUniqueCode() {
    const length = 8;
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

    let code;
    let isUnique = false;

    while (!isUnique) {
        code = "";
        for (let i = 0; i < length; i++) {
            code += characters.charAt(Math.floor(Math.random() * characters.length));
        }

        const existingUser = await User.findOne({ verificationCode: code });
        isUnique = !existingUser;
    }

    return code;
}