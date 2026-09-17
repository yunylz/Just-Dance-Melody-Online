import { file } from "../lib/cache";
import { createLogger } from "../lib/logger";
import { client as redis } from "../lib/redis";
import { WdfClients } from "../types/wdf";

const logger = createLogger({ service: "wdf/newsfeed" });
const wdfConfig = file<any>("/data/config.json");

let wdfStats: any;

const currentNewsFeedKey      = (room: string) => `wdf:rooms:${room}:news-feed-current`;
const preparedAutomaticEntriesKey = (room: string) => `wdf:rooms:${room}:news-feed-preparedAutomaticEntries`;

const allNewsFeedEntriesKey  = "wdf:news-feed-entries";
const poolsKey               = "wdf:news-feed-pools";
const poolsWithEntriesKey    = "wdf:news-feed-pool-entry-map";
const variableRegex          = /\[var:(.*?)\]/gi;
const newsFeedTypes          = { automatic: "automatic", countdown: "countdown", manual: "manual" };
const defaultDisplayDuration = 3;

export const init = (_clients: WdfClients): void => { return; };
