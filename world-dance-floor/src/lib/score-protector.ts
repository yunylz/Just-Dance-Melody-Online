import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Request, Response, NextFunction } from "express";

type Platform = "x1" | "ps4" | "pc" | "nx" | "wiiu" | "default";

interface RsaKeyPair {
    privateKey: string;
    publicKey: string;
}

interface PlatformKeys {
    rsa: RsaKeyPair;
}

type ScoreType = "int" | "float" | "floatWithTimestamp";

interface DecryptionParams {
    encryptedScoreField: string;
    scoreField: string;
}

interface ScoreOperations {
    encrypt(score: number, platform: string): string;
    decrypt(req: Request, params: DecryptionParams, next: NextFunction): void;
    sign(score: number, platform: string): string;
}

const platforms: Platform[] = ["x1", "ps4", "pc", "nx", "wiiu"];
const keys: Record<string, PlatformKeys> = {};

export const init = async (): Promise<void> => {
    const hashes = crypto.getHashes();
    if (!hashes.includes("RSA-SHA256"))
        throw new Error("Hash algorithm RSA-SHA256 is not available");

    const ciphers = crypto.getCiphers();
    if (!ciphers.includes("aes-128-cbc"))
        throw new Error("Cipher algorithm aes-128-cbc is not available");

    for (const platform of platforms) {
        keys[platform] = {
            rsa: {
                privateKey: fs.readFileSync(path.join(global.root, "data/score-protector-keys/" + platform + "/private.pem"), "utf8"),
                publicKey: fs.readFileSync(path.join(global.root, "data/score-protector-keys/" + platform + "/public.pem"), "utf8")
            }
        };
    }

    keys.default = { rsa: keys.pc.rsa };
};

const encryptScoreAESAndRSA = (score: string, platform: string): string => {
    const aesKey = crypto.randomBytes(16);
    const aesIV = crypto.randomBytes(16);

    const aes = crypto.createCipheriv("aes-128-cbc", aesKey, aesIV);
    let encryptedScore = aes.update(score, "utf8", "base64");
    encryptedScore += aes.final("base64");

    const publicKey = keys[platform]?.rsa.publicKey ?? keys.default.rsa.publicKey;

    const encryptedAESKey = crypto.publicEncrypt(publicKey, aesKey).toString("base64");
    const encryptedAESIV = crypto.publicEncrypt(publicKey, aesIV).toString("base64");

    return `${encryptedScore}.${encryptedAESKey}.${encryptedAESIV}`;
};

const decryptScoreAESAndRSA = (encryptedScore: string, platform: string): string | null => {
    const parts = encryptedScore.split(".");
    if (parts.length !== 3) return null;

    const privateKey = keys[platform]?.rsa.privateKey ?? keys.default.rsa.privateKey;

    const aesKey = crypto.privateDecrypt(privateKey, Buffer.from(parts[1], "base64"));
    const aesIV = crypto.privateDecrypt(privateKey, Buffer.from(parts[2], "base64"));

    const aes = crypto.createDecipheriv("aes-128-cbc", aesKey, aesIV);
    let decryptedScore = aes.update(parts[0], "base64", "utf8");
    decryptedScore += aes.final("utf8");

    return decryptedScore;
};

const signScore = (score: string, platform: string): string => {
    const signObj = crypto.createSign("RSA-SHA256");
    signObj.update(score);
    const privateKey = keys[platform]?.rsa.privateKey ?? keys.default.rsa.privateKey;
    return signObj.sign(privateKey, "base64");
};

const operationsPerScoreType: Record<ScoreType, ScoreOperations> = {
    "int": {
        encrypt(score, platform) {
            return encryptScoreAESAndRSA(score.toFixed(0), platform);
        },
        decrypt(req, decryptionParams, next) {
            const encryptedScore = req.body[decryptionParams.encryptedScoreField];
            const platform = req.sku.platform;
            const score = parseInt(decryptScoreAESAndRSA(encryptedScore, platform) ?? "");
            if (isNaN(score)) return next(new Error("float score decryption failed"));
            req.body[decryptionParams.scoreField] = score;
            return next();
        },
        sign(score, platform) {
            return signScore(score.toFixed(0), platform);
        }
    },
    "float": {
        encrypt(score, platform) {
            return encryptScoreAESAndRSA(score.toFixed(6), platform);
        },
        decrypt(req, decryptionParams, next) {
            const encryptedScore = req.body[decryptionParams.encryptedScoreField];
            const platform = req.sku.platform;
            const score = parseFloat(decryptScoreAESAndRSA(encryptedScore, platform) ?? "");
            if (isNaN(score)) return next(new Error("float score decryption failed"));
            req.body[decryptionParams.scoreField] = score;
            return next();
        },
        sign(score, platform) {
            return signScore(score.toFixed(6), platform);
        }
    },
    "floatWithTimestamp": {
        encrypt(score, platform) {
            return encryptScoreAESAndRSA(score.toFixed(6) + ":" + (Date.now() / 1000).toFixed(6), platform);
        },
        decrypt(req, decryptionParams, next) {
            const encryptedScore = req.body[decryptionParams.encryptedScoreField];
            const platform = req.sku.platform;
            const decryptedScore = decryptScoreAESAndRSA(encryptedScore, platform);

            let score = NaN;
            const parts = (decryptedScore ?? "").split(":");
            if (parts.length === 2) {
                score = parseFloat(parts[0]);
            }

            if (isNaN(score)) return next(new Error("floatWithTimestamp score decryption failed"));
            req.body[decryptionParams.scoreField] = score;
            return next();
        },
        sign(score, platform) {
            return signScore(score.toFixed(6), platform);
        }
    }
};

export const decrypt = (encryptedScoreField: string, scoreField: string, scoreType: ScoreType) => {
    if (!operationsPerScoreType[scoreType]) {
        throw new Error("Invalid score type for decryption: " + scoreType);
    }

    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.sku) return next(new Error("sku info missing"));

        if (!Object.prototype.hasOwnProperty.call(req.body, scoreField) ||
            !Object.prototype.hasOwnProperty.call(req.body, encryptedScoreField)) {
            res.sendStatus(400);
            return;
        }

        return operationsPerScoreType[scoreType].decrypt(req, {
            encryptedScoreField,
            scoreField
        }, next);
    };
};

export const encrypt = (score: number, scoreType: ScoreType, platform: string): string => {
    if (!operationsPerScoreType[scoreType]) {
        throw new Error("Invalid score type for encryption: " + scoreType);
    }
    return operationsPerScoreType[scoreType].encrypt(score, platform);
};

export const sign = (score: number, scoreType: ScoreType, platform: string): string => {
    if (!operationsPerScoreType[scoreType]) {
        throw new Error("Invalid score type for signing: " + scoreType);
    }
    return operationsPerScoreType[scoreType].sign(score, platform);
};
