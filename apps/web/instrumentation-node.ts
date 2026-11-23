// Só no runtime Node do servidor: C4 (filtro de PEM em stdout/stderr) e C2 (rejeição ou exceção sem tratamento: log saneado e saída com código 1).
import { installOutputFilter, installProcessGuards } from '@ln/db/safe-log';

installOutputFilter();
installProcessGuards();
