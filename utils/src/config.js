module.exports = {
    PORT: process.env.PORT || 5442,
    MONGODB: {
        URI: process.env.MONGO_URI
    },
    WEBHOOKS: {
        VERIFICATION: process.env.VERIFICATION_WEBHOOK_URL
    }
}