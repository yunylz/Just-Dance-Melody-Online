/**
 * Configuration file for the API and WDF.
 */

export const ENV       = process.env.NODE_ENV || "local";
export const LOG_LEVEL = process.env.LOG_LEVEL || "info";
export const PORT      = process.env.PORT || 5441;

export const REDIS = {
    HOST:     process.env.REDIS_HOST || null,
    PORT:     process.env.REDIS_PORT || null,
    PASSWORD: process.env.REDIS_PASSWORD || null,
};
