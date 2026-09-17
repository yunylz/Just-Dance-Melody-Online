/**
 * Custom emoji list
 * @returns {Object} Emoji list
 */
const list = require("../data/emojis.json");

/**
 * Get a formatted emoji string by its name
 * @param {String} name Emoji name
 * @returns {String} Formatted emoji string
 */
const get = (name) => {
    if (!list[name]) return;

    const emoji = list[name];

    return `<${emoji.animated ? "a" : ""}:${emoji.name}:${emoji.id}>`;
}

module.exports = {
    get,
    list
}