-- Rollback da 0036: só remove o trigger de linha. Nenhuma linha de openbot_pilot_resolutions é tocada.
DROP TRIGGER IF EXISTS openbot_pilot_resolutions_append_only ON openbot_pilot_resolutions;
