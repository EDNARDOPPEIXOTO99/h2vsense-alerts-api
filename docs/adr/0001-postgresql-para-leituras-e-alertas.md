# 0001 — PostgreSQL para leituras e alertas (em vez de banco de séries temporais)

- **Status:** aceita
- **Data:** 2026-11-07
- **Decisor:** Ednardo Pinheiro Peixoto

## Contexto e problema

A API recebe leituras de concentração de H2 (ppm) de sensores e mantém alertas de vazamento. Leituras são, por natureza, uma **série temporal**: chegam continuamente, são consultadas por sensor e janela de tempo, e o volume cresce rápido. Alertas, por outro lado, são **dados transacionais**: têm estado (aberto → reconhecido) e uma regra forte de consistência (no máximo um alerta aberto por sensor, sem perder contagem quando leituras chegam ao mesmo tempo).

Eu preciso decidir onde guardar os dois.

## Fatores de decisão

- Garantir a regra "1 alerta aberto por sensor" mesmo com leituras concorrentes.
- Entregar em 8 dias, com o fluxo principal funcionando de ponta a ponta.
- Subir tudo com um comando (`docker compose up`) e ter teste de integração com banco real no CI.
- Volume previsto nesta fase: dezenas de sensores por planta-piloto, uma leitura a cada poucos segundos.

## Opções consideradas

1. **PostgreSQL** para leituras e alertas.
2. **InfluxDB** (série temporal) para leituras + PostgreSQL para alertas.
3. **TimescaleDB** (extensão de séries temporais sobre o Postgres).

## Decisão

Escolhi a **opção 1: PostgreSQL** para tudo, com índice `(sensor_id, measured_at DESC)` nas leituras.

A regra de consistência é o coração do domínio, e o Postgres resolve com recursos nativos:

- **índice único parcial** `ON alerts (sensor_id) WHERE status = 'open'`: o próprio banco recusa um segundo alerta aberto;
- **transação + `pg_advisory_xact_lock` por sensor**: serializa só as leituras do mesmo sensor, então "buscar alerta aberto → atualizar" não perde atualização, e sensores diferentes seguem em paralelo.

O teste de integração dispara 10 leituras simultâneas do mesmo sensor e confere 1 alerta com contagem 10.

## Alternativa descartada: InfluxDB + PostgreSQL

Seria a escolha "certa no papel" para a série temporal (compressão, retenção automática, agregações por janela). Descartei agora porque:

- **dois bancos para manter** (Compose, CI, backup, conhecimento) num escopo de nível B;
- **sem transação entre os dois**: gravar a leitura no Influx e atualizar o alerta no Postgres poderia deixar os dois inconsistentes se um falhar no meio;
- o volume atual (estimo na ordem de milhares de leituras por minuto) é tranquilo para o Postgres com o índice certo; o smoke test mediu p95 de ~9 ms no `POST /readings` (Windows + Docker Desktop).

## TimescaleDB

Fica como **caminho de evolução natural**: é Postgres, então o código e as migrações continuam valendo, e a tabela `readings` vira uma *hypertable* com retenção e compressão. Não adotei agora para manter a imagem oficial do Postgres e não ter dependência extra sem necessidade medida.

## Consequências

**Positivas**

- Uma tecnologia só; Compose e CI simples.
- Consistência forte do alerta garantida no banco, não só no código.
- O Repository isola o SQL: migrar a tabela de leituras para TimescaleDB ou Influx no futuro não muda domínio nem casos de uso.

**Negativas / riscos**

- A tabela `readings` cresce sem limite. **Gatilho para revisitar esta decisão:** passar de ~10 milhões de linhas ou o p95 do `POST /readings` passar de 100 ms. Aí eu adoto TimescaleDB (retenção + compressão) ou particionamento nativo por mês.
- Consultas analíticas pesadas (médias por janela em meses de dados) não são o ponto forte aqui.
