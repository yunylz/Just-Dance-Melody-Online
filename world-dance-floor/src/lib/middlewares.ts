import express, { Application, Request, Response, NextFunction } from "express";
import { file } from "./cache";
import { client as redis } from "./redis";
import * as oasis from "./oasis";
import { SkuInfo, RoomConfig } from "../types/wdf";

interface SkuFile {
    skus: SkuInfo[];
}

interface RoomsFile {
    rooms: RoomConfig[];
}

export const init = (app: Application): void => {
    app.set("etag", false);
    app.set("x-powered-by", false);

    app.use(express.json());

    app.use(appendLanguage);
    app.use(appendSku);
    app.use(appendToken);
    app.use(appendProfile);
    app.use(appendRoom);
};

const appendSku = (req: Request, res: Response, next: NextFunction): void => {
    const clientSku = req.headers["x-skuid"] as string;

    const { skus } = file<SkuFile>("/data/skus.json");

    const sku = skus.find(s => s.skuId === clientSku);

    if (!sku) {
        res.status(403).send({ error: "sku not authorized for WDF" });
        return;
    }

    req.sku = sku;
    next();
};

const appendToken = (req: Request, res: Response, next: NextFunction): void => {
    const authorizationHeader = req.headers["authorization"];

    if (!authorizationHeader) {
        res.status(401).send({ error: "invalid authorization header" });
        return;
    }

    const tokenHeader = authorizationHeader.split(" ");

    switch (tokenHeader[0]) {
        case "Ubi_v1":
            (req as any).authorization = {
                type: "ubi",
                token: tokenHeader[1],
                raw: authorizationHeader
            };
            break;
        default:
            res.status(401).send({ error: "invalid authorization header" });
            return;
    }

    next();
};

const appendProfile = (req: Request, res: Response, next: NextFunction): void => {
    (async () => {
        const partialToken = req.headers["authorization"]!.substring(7, 257);

        const profileKey = `userProfileData:${partialToken}`;
        const profileData = await redis.get(profileKey);

        const tokenKey = `validatedTokens:${partialToken}`;
        const tokenData = await redis.get(tokenKey);

        if (!profileData || !tokenData) {
            res.status(401).send({
                error: "invalid token or profile data",
                profile: profileData,
                token: tokenData
            });
            return;
        }

        req.profile = JSON.parse(profileData as string);
        req.tokenData = JSON.parse(tokenData as string);

        next();
    })();
};

const appendRoom = (req: Request, res: Response, next: NextFunction): void => {
    const { rooms } = file<RoomsFile>("/data/rooms.json");

    const room = rooms.find(r => r.skus.includes(req.sku.id));

    req.room = room!;

    next();
};

const appendLanguage = (req: Request, res: Response, next: NextFunction): void => {
    if (req.language) return next();

    req.language = oasis.defaultLanguage;
    req.languageIndex = oasis.defaultLanguageIndex;

    const acceptLanguages = req.headers["accept-language"];
    if (acceptLanguages) {
        acceptLanguages.toLowerCase().split(",").some(function (language) {
            language = oasis.getBaseLanguage(language.trim());

            const index = language.indexOf(";");
            if (index !== -1) {
                language = language.substring(0, index);
            }

            const languageIndex = oasis.languages.indexOf(language);
            if (languageIndex !== -1) {
                req.language = language;
                req.languageIndex = languageIndex;
                return true;
            }
        });
    }

    next();
};
