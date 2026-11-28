# Coleta contínua: o que é uma "rodada boa" (DP-94, condição 4)

Definição aceita por ora pelo Program Manager em 28/11/2026, **a rever depois do ensaio de 24 horas no staging**. A DP-94 não define o termo.

- **Rodada boa:** ao menos uma fonte devolveu ao menos um item. Item repetido conta: a fonte respondeu.
- **Prazo:** passadas mais de 5 horas sem rodada boa, o worker grava `collector.alert` na trilha e uma linha `ALERTA coleta` no log; persistindo, repete a cada 5 horas.
- **Registro:** cada rodada grava `collector.round.sources` (uma linha por fonte) e depois `collector.round`, que começa com `rodada boa;` ou `rodada sem item;`.
- **Rodada sem fonte habilitada** não é registrada; o prazo continua correndo e o aviso sai.

## Dois limites desta definição

1. **Alarme falso:** se as fontes habilitadas simplesmente não publicarem nada por 5 horas (duas ou três rodadas), o aviso sai sem haver defeito.
2. **Falha escondida:** uma única fonte entregando item torna a rodada boa, ainda que todas as outras estejam falhando. A falha por fonte aparece no registro de cada rodada, mas não gera aviso.

## Estado público para o vigia externo

`GET /api/status/coleta`, sem login, responde só `{ "estado", "ultimaRodadaBoaEm" }`: **200** em `ok`; **503** em `atrasada` (mais de 5 horas), `nunca` (nenhuma rodada boa gravada) e `indisponivel` (banco ausente, falhando ou lento). Olha o registro gravado, então acusa também worker parado e chave desligada. A leitura é guardada por 60 s (falha: 10 s) em cada processo. Os dois limites acima valem também aqui. Quem consulta e avisa uma pessoa é o vigia externo, que não faz parte do produto.

## O que o aviso não cobre

Ele vive no processo do worker e só vai para o log e a trilha: com o worker parado ou a chave desligada não há aviso, e ninguém é notificado. Isso depende de vigia externo.
