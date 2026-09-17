// External modules

// Internal modules
const cache = require("./cache");
const logger = require("./logger").createLogger({ service: "oasis" });

const localization = cache.file("/data/localization.json");

var languages = ["ja", "ko", "nl", "fr", "de", "es", "en", "da", "fi", "nb", "sv", "pt-br", "it", "zh-cn", "ru", "zh-tw"];

var defaultLanguage = "en";
// ["ja", "ko", "nl", "fr", "de", "es", "en", "da", "fi", "nb", "sv", "pt-br", "it", "zh-cn", "ru", "zh-tw"]
var defaultLanguageIndex = languages.indexOf(defaultLanguage);


const getLocalizedString = (id, languageIndex) => {
    if (!localization) {
        logger.warn(`Localization data not loaded`);
        return `<MISSING:${id}>`;
    }
    
    var translations = localization[id];

    if (!translations) {
        logger.warn(`Missing localization for id: ${id}`);
        return `<MISSING:${id}>`;
    }

    var string = translations[languageIndex];

    if (!string) {
        logger.warn(`Missing localization for id: ${id} in language index: ${languageIndex}`);
        return `<MISSING:${id}:${languages[languageIndex]}>`;
    }

    return string;
};

const getBaseLanguage = (language) => {
    switch (language) {
        case "pt":
            return "pt-br";
        // they fucked this up in jd17-jd18 apparently lmfaoooo
        case "th":
        case "th-tw":
            return "zh-tw";
        default:
            return language;
    }
};

const getLocalization = (id, language) => {
    var languageIndex = languages.indexOf(language);
    if (languageIndex === -1) {
        logger.warn(`Unsupported language: ${language}`);
        return "<MISSING:" + language + ">";
    }

    return getLocalizedString(id, languageIndex);
}

module.exports = {
    languages,
    localization,
    defaultLanguage,
    defaultLanguageIndex,
    getLocalizedString,
    getLocalization,
    getBaseLanguage
};