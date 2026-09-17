import * as map from "./themes/map";
import * as vote from "./themes/vote";
import * as teambattle from "./themes/teambattle";
import * as tournament from "./themes/tournament";
import * as boss from "./themes/boss";
import { WdfClients } from "../types/wdf";

export const init = (clients: WdfClients): void => {
    map.initModule(clients);
    vote.initModule(clients);
    teambattle.initModule(clients);
    tournament.initModule(clients);
    boss.initModule(clients);
};

export { map, vote, teambattle, tournament, boss };
