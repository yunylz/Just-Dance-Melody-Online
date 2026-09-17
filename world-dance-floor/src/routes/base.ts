import express, { Request, Response, NextFunction, Router } from "express";
import { file } from "../lib/cache";
import { WdfClients } from "../types/wdf";

const router: Router = express.Router();
let clients: WdfClients;

router.post("/assign-room", (req: Request, res: Response, next: NextFunction) => {
    const sku   = (req as any).sku;
    const room  = (req as any).room;

    if (["jd2021", "jd2022"].includes(sku.gameVersion)) {
        res.json({ __class: "RoomInfo", room: room.roomName, type: "hard", start: null, end: null });
    } else {
        res.json({ room: room.roomName });
    }
});

router.get("/online-bosses", (_req: Request, res: Response) => {
    const { bosses } = file<any>("/data/bosses.json");
    const bossesClone = { ...bosses };
    for (const bossKey in bossesClone) {
        if (bossesClone[bossKey].config) delete bossesClone[bossKey].config;
    }
    res.json({ "__class": "OnlineBossDb", "bosses": bossesClone || {} });
});

router.get("/server-time", (_req: Request, res: Response, next: NextFunction) => {
    res.json({ "time": Date.now() / 1000 });
    next();
});

export default (clientsList: WdfClients): Router => {
    clients = clientsList;
    return router;
};
