import express, { Request, Response, NextFunction, Router } from "express";
import { file } from "../lib/cache";
import { createLogger } from "../lib/logger";
import { getLocalization } from "../lib/oasis";
import { client as redis } from "../lib/redis";
import { sign } from "../lib/score-protector";
import { WdfClients } from "../types/wdf";

const logger = createLogger({ service: "routes/rooms" });

let wdfLeaderboard: any;
let wdfNotifications: any;
let wdfRoomManager: any;
let wdfSessions: any;

const router: Router = express.Router();

const checkRoomExistsAndIsCorrectMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const { rooms } = file<any>("/data/rooms.json");
    const sku = (req as any).sku;
    const correctRoom = rooms.find((r: any) => r.skus.includes(sku.id));
    if (!correctRoom || req.params.room !== correctRoom.roomName) {
        res.status(400).send({ error: "room does not exist or is not correct for this SKU" });
        return;
    }
    next();
};

const scoreValidityMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const tokenData = (req as any).tokenData;
    if (!req.body.score) {
        logger.warn(`No score submitted in room '${req.params.room}' by pid '${tokenData.ProfileId}'`);
        return next();
    }
    if (req.body.score < 0 || req.body.score > 1) {
        logger.warn(`Invalid score submitted in room '${req.params.room}' by pid '${tokenData.ProfileId}': ${req.body.score}`);
        res.status(400).send({ error: "invalid score submitted, you've been logged :3" });
        return;
    } else if (req.body.score === 1) {
        logger.warn(`Perfect score (1) submitted in room '${req.params.room}' by pid '${tokenData.ProfileId}'`);
    }
    next();
};

router.post("/:room/screens", async (req: Request, res: Response, next: NextFunction) => {
    let screens: string[] = await (redis as any).zRangeByScore(`wdf:rooms:${req.params.room}:screens`, req.body.startTime, "+inf");
    if (!screens || screens.length === 0) screens = [];
    res.setHeader("Content-Type", "application/json");
    res.send('{ "__class":"ScreenList", "screens": [' + screens.join(",") + "] }");
    next();
});

router.get("/:room/ccu", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const ccu = await wdfSessions.getNumberOfPlayers({ room: req.params.room });
        res.send("" + ccu);
        next();
    } catch { res.sendStatus(500); next(); }
});

router.get("/:room/next-happyhours", (_req: Request, res: Response, next: NextFunction) => {
    res.json({
        "__class": "HappyHoursInfo",
        "start": Date.now() / 1000 - 60000,
        "end": Date.now() / 1000 + 18327600,
        "running": true
    });
    next();
});

router.post("/:room/session", async (req: Request, res: Response, next: NextFunction) => {
    const pid = (req as any).tokenData.ProfileId;
    try {
        await wdfSessions.joinSession({ room: req.params.room, pid, platform: (req as any).sku.platform, profile: (req as any).profile });
        res.sendStatus(200); next();
    } catch { res.sendStatus(500); next(); }
});

router.delete("/:room/session", async (req: Request, res: Response, next: NextFunction) => {
    const pid = (req as any).tokenData.ProfileId;
    try {
        await wdfSessions.leaveSession({ room: req.params.room, pid });
        res.sendStatus(200); next();
    } catch { res.sendStatus(500); next(); }
});

router.get("/:room/session-recap", async (req: Request, res: Response, next: NextFunction) => {
    const pid = (req as any).tokenData.ProfileId;
    try {
        const sessionInfo = await wdfSessions.getSessionInfo({ room: req.params.room, pid });
        sessionInfo.__class = "SessionRecapInfo";
        res.json(sessionInfo); next();
    } catch { res.sendStatus(500); next(); }
});

router.get("/:room/newsfeed", (_req: Request, res: Response, next: NextFunction) => {
    res.json({
        "__class": "NewsfeedList",
        "entries": [{
            "__class": "NewsfeedEntry",
            "pictureUrl": "https://jdmo-cdn.c0llydoll.com/public/wdf/newsfeed/seasonalLogos/dfb2287af095f1440fdbc3a4fc05b019.png",
            "text": "You are currently playing\nJust Dance Melody Online :D",
            "title": "Welcome back !"
        }]
    });
    next();
});

router.get("/:room/online-rank-widget", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const currentSeasonDetails = await wdfLeaderboard.getCurrentSeasonDetails({ room: req.params.room });
        const currentSeasonEndTime = currentSeasonDetails?.endTime ? currentSeasonDetails.endTime / 1000 : null;
        const seasonNumber = currentSeasonDetails ? currentSeasonDetails.seasonNumber : null;
        const pid = (req as any).tokenData.ProfileId;

        const [currentRank, prevRank, dancerCount, prevWinner] = await Promise.all([
            wdfLeaderboard.getLb({ room: req.params.room, pid }),
            wdfLeaderboard.getLbPreviousSeason({ room: req.params.room, pid }),
            wdfLeaderboard.getCurrentSeasonLbLen({ room: req.params.room }),
            wdfLeaderboard.getLbPreviousSeason({ room: req.params.room, rank: 1 })
        ]);

        if (currentRank[0]) { currentRank[0].__class = "WDFOnlineRankInfo"; currentRank[0].dc.__class = "ScoreEntry"; }
        if (prevRank[0]) { prevRank[0].__class = "WDFOnlineRankInfo"; prevRank[0].dc.__class = "ScoreEntry"; }
        if (prevWinner[0]) { prevWinner[0].__class = "WDFOnlineRankInfo"; prevWinner[0].dc.__class = "ScoreEntry"; }

        res.json({
            "__class": "OnlineRankWidgetInfo",
            "currentSeasonEndTime": currentSeasonEndTime,
            "seasonNumber": seasonNumber,
            "currentSeasonDancerCount": dancerCount,
            "previousSeasonWinner": prevWinner[0],
            "currentUserOnlineRankInfo": currentRank[0],
            "currentUserPreviousSeasonOnlineRankInfo": prevRank[0]
        });
    } catch { res.sendStatus(500); next(); }
});

router.get("/:room/notification", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const notification = await wdfNotifications.getNotification({ room: req.params.room, language: (req as any).language });
        res.json(notification); next();
    } catch { res.sendStatus(500); next(); }
});

router.post("/:room/themes/:type/update-scores", scoreValidityMiddleware, async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await wdfRoomManager.forwardUpdateScores({ room: req.params.room, type: req.params.type, pid: (req as any).tokenData.ProfileId, score: req.body });
        res.json(result); next();
    } catch (err: any) { console.error(`Error in updating scores: ${err.stack}`); res.sendStatus(500); next(); }
});

router.get("/:room/themes/:type/score-recap", async (req: Request, res: Response, next: NextFunction) => {
    try {
        const recap = await wdfRoomManager.forwardGetScoreRecap({ room: req.params.room, type: req.params.type, pid: (req as any).tokenData.ProfileId, score: req.body });
        res.json(recap); next();
    } catch (err: any) { console.error(`Error in getting score recap: ${err.stack}`); res.sendStatus(500); next(); }
});

router.post("/:room/themes/vote/choice", async (req: Request, res: Response, next: NextFunction) => {
    try {
        await (redis as any).incr(`wdf:rooms:${req.params.room}:vote-option:${req.body.voteOption}`);
        res.sendStatus(200);
    } catch (err: any) { console.error(`Error in submitting vote: ${err.stack}`); res.sendStatus(500); next(); }
});

router.get("/:room/themes/vote/result", async (req: Request, res: Response, next: NextFunction) => {
    const getVoteResult = async (room: string): Promise<any[]|null> => {
        const value = await (redis as any).get(`wdf:rooms:${room}:vote-result`);
        try { return JSON.parse(value); } catch { return null; }
    };

    try {
        let value = await getVoteResult(req.params.room as string);
        if (!value) {
            logger.warn(`[${req.params.room}] Vote result not ready yet, waiting...`);
            const poll = async (): Promise<void> => {
                value = await getVoteResult(req.params.room as string);
                if (value) {
                    value.forEach(e => (e.__class = "VoteResultEntry"));
                    res.json({ "__class": "VoteResult", entries: value });
                    next();
                } else { setTimeout(poll, 100); }
            };
            setTimeout(poll, 100);
        } else {
            value.forEach(e => ((e as any).__class = "VoteResultEntry"));
            res.json({ "__class": "VoteResult", entries: value });
            next();
        }
    } catch (err: any) { console.error(`Error in getting vote result: ${err.stack}`); res.sendStatus(500); next(); }
});

router.post("/:room/themes/teambattle/team-names", (req: Request, res: Response, next: NextFunction) => {
    if (req.body.teamLocIds.length !== 2) { res.sendStatus(400); return; }
    const teamNames = req.body.teamLocIds.map((locId: string) => getLocalization(locId, (req as any).language));
    res.json({ __class: "TeamBattleTeamNames", localisedTeamNames: teamNames });
    next();
});

router.get("/:room/themes/:type/score-status", async (req: Request, res: Response, next: NextFunction) => {
    const sku = (req as any).sku;
    const pid = (req as any).tokenData.ProfileId;
    const result = await wdfRoomManager.forwardGetScoreStatus({ room: req.params.room, type: req.params.type, pid });
    let sendScoreSignature = true;
    if ((sku.gameVersion === "jd2017" && sku.platform !== "pc") || sku.gameVersion === "jd2018") sendScoreSignature = false;
    if (sendScoreSignature) result.scoreSignature = sign(result.score, "float", sku.platform);
    res.json(result);
    next();
});

export default (clientsIn: WdfClients): Router => {
    wdfLeaderboard    = clientsIn.wdfLeaderboard;
    wdfNotifications  = clientsIn.wdfNotifications;
    wdfRoomManager    = clientsIn.wdfRoomManager;
    wdfSessions       = clientsIn.wdfSessions;
    return router;
};
