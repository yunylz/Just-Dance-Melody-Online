import express, { Router } from "express";
import { WdfClients } from "../types/wdf";

let clients: WdfClients;
const router: Router = express.Router();

export default (clientsList: WdfClients): Router => {
    clients = clientsList;
    return router;
};
