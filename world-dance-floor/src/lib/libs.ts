import path from "node:path";
import { createLogger } from "./logger";
import { WdfClients } from "../types/wdf";

const logger = createLogger({ service: "libs" });

const rootPath = global.root;

const instantiateClients = (clientsList: Record<string, string>): Record<string, any> => {
    const instantiated: Record<string, any> = {};

    for (const key of Object.keys(clientsList)) {
        instantiated[key] = require(path.join(rootPath, clientsList[key], ".ts"));
    }

    return instantiated;
};

const initializeClients = (clients: Record<string, any>): Record<string, any> => {
    for (const key of Object.keys(clients)) {
        const client = clients[key];
        if (client.init && typeof client.init === "function") {
            client.init(clients);
        }
    }

    logger.info("Initialized: " + Object.keys(clients).join(", "));

    return clients;
};

export const init = (clientsList: Record<string, string>): WdfClients => {
    let clients = instantiateClients(clientsList);
    clients = initializeClients(clients);
    return clients as WdfClients;
};
