import * as map from "./scoring/map";
import * as teambattle from "./scoring/teambattle";
import * as tournament from "./scoring/tournament";
import * as boss from "./scoring/boss";
import { WdfClients } from "../types/wdf";

export const init = (clients: WdfClients): void => {
    map.init(clients);
    teambattle.init(clients);
    tournament.init(clients);
    boss.init(clients);
};

export { map, teambattle, tournament, boss };
