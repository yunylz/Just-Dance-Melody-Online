// Augment Express Request with WDF-specific properties

import { SkuInfo, RoomConfig, PlayerProfile, TokenData } from "./wdf";

declare global {
    namespace Express {
        interface Request {
            sku: SkuInfo;
            room: RoomConfig;
            profile: PlayerProfile;
            tokenData: TokenData;
            language: string;
            languageIndex: number;
        }
    }
}

export {};
