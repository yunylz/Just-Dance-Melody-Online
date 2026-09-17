import { file } from "./cache";
import { createLogger } from "./logger";

const logger = createLogger({ service: "oasis" });

const localization = file<Record<string, string[]>>("/data/localization.json");

export const languages: string[] = ["ja", "ko", "nl", "fr", "de", "es", "en", "da", "fi", "nb", "sv", "pt-br", "it", "zh-cn", "ru", "zh-tw"];

export const defaultLanguage = "en";
export const defaultLanguageIndex = languages.indexOf(defaultLanguage);

export const getLocalizedString = (id: string, languageIndex: number): string => {
    if (!localization) {
        logger.warn(`Localization data not loaded`);
        return `<MISSING:${id}>`;
    }

    const translations = localization[id];

    if (!translations) {
        logger.warn(`Missing localization for id: ${id}`);
        return `<MISSING:${id}>`;
    }

    const str = translations[languageIndex];

    if (!str) {
        logger.warn(`Missing localization for id: ${id} in language index: ${languageIndex}`);
        return `<MISSING:${id}:${languages[languageIndex]}>`;
    }

    return str;
};

export const getBaseLanguage = (language: string): string => {
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

export const getLocalization = (id: string, language: string): string => {
    const languageIndex = languages.indexOf(language);
    if (languageIndex === -1) {
        logger.warn(`Unsupported language: ${language}`);
        return `<MISSING:${language}>`;
    }

    return getLocalizedString(id, languageIndex);
};
