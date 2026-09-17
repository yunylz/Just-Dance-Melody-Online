// External modules
const path = require("node:path");

// Internal modules
const logger = require("../lib/logger").createLogger({ service: "libs" });

const rootPath = global.root;

const instantiateClients = (clients) => {
    var instantiatedClients = {};
    
    Object.keys(clients).forEach((client) => {
        instantiatedClients[client] = require(path.join(rootPath, clients[client]));
    });

    return instantiatedClients;
};

const initializeClients = (clients) => {
    Object.keys(clients).forEach((client) => {
        var client = clients[client];

        if (client.init && typeof client.init === "function") {
            client.init(clients);
        }
    });

    logger.info("Initialized: " + Object.keys(clients).join(", "));

    return clients;
};

const init = (clientsList) => {
    var clients = instantiateClients(clientsList);
    clients = initializeClients(clients);
    return clients;
};


module.exports = {
    init
};