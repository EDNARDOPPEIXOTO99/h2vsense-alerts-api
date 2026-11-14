# Observabilidade

## Logs estruturados

Uso **pino**, que escreve JSON em uma linha por evento. Todo log tem `service`, `env`, `time` (ISO) e, nas requisições, o objeto `req` (id, método, URL) e, ao final, status e duração (via `pino-http`). Cabeçalhos `authorization` e `cookie` são mascarados.

Eventos de negócio que eu registro:

| Evento | Nível | Campos |
|---|---|---|
| alerta aberto ou escalado | `warn` | `sensorId`, `ppm`, `alertId`, `severity`, `alertAction` |
| alerta reconhecido | `info` | `alertId`, `acknowledgedBy` |
| erro não tratado | `error` | `err` (stack só no log, nunca na resposta) |

Exemplo:

```json
{"level":40,"time":"2026-11-07T21:35:57.026Z","service":"h2vsense-alerts-api","env":"production","req":{"id":1,"method":"POST","url":"/readings"},"sensorId":"ELETROLISADOR-01","ppm":13500,"alertId":"e4b7af57-...","severity":"alarm","alertAction":"opened","msg":"alerta de vazamento de H2"}
```

(Linha real, com os cabeçalhos do `req` omitidos aqui por espaço.)

O nível vem de `LOG_LEVEL` (padrão `info`).

## Métrica

Exposta em `GET /metrics` (formato Prometheus, com `prom-client`):

| Métrica | Tipo | Para quê |
|---|---|---|
| `h2_alerts_opened_total{severity}` | counter | **métrica de negócio**: quantos alertas de atenção/alarme abriram |
| `h2_readings_ingested_total{severity}` | counter | volume de leituras por faixa |
| `http_request_duration_seconds{method,route,status_code}` | histogram | latência por rota; base do SLO |

Uso o **padrão da rota** (`/alerts/:id/ack`) como label, e não a URL, para não explodir a cardinalidade.

Com `docker compose --profile observability up --build`, o Prometheus coleta a cada 5 s em `http://localhost:9090`.

## SLO

| | |
|---|---|
| **Serviço** | ingestão de leituras (`POST /readings`) |
| **SLI** | proporção de requisições `POST /readings` com status 2xx respondidas em menos de 200 ms |
| **Objetivo** | **95%** |
| **Janela** | 28 dias corridos |

Por que 200 ms: o sensor envia leituras a cada poucos segundos; 200 ms deixa folga grande para o dispositivo não acumular fila e para o alarme chegar ao operador em tempo útil.

Consulta PromQL do SLI:

```promql
sum(rate(http_request_duration_seconds_bucket{route="/readings",method="POST",status_code=~"2..",le="0.2"}[28d]))
/
sum(rate(http_request_duration_seconds_count{route="/readings",method="POST",status_code=~"2.."}[28d]))
```

O mesmo alvo está como `threshold` no smoke test k6 (`p(95)<200`), então o teste falha se o SLO for violado. Resultado medido em [`desempenho.md`](desempenho.md).

## Como eu verifico no Prometheus

```powershell
docker compose --profile observability down -v   # banco e métricas zerados
docker compose --profile observability up -d
k6 run k6/smoke.js                               # gera tráfego por 30 s
```

1. Abro `http://localhost:9090` → **Status → Target health**: o alvo `h2vsense-alerts-api` (`http://api:3000/metrics`) aparece **UP**.
2. Na aba **Query**, rodo as consultas abaixo (**Execute**; a aba **Graph** mostra a curva):

| Consulta | O que mostra |
|---|---|
| `h2_readings_ingested_total` | leituras recebidas por severidade |
| `h2_alerts_opened_total` | alertas **abertos** por severidade |
| `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{route="/readings"}[5m])) by (le))` | p95 do `POST /readings`, em segundos (0.009 = 9 ms) |

O que observei em 2026-11-14 (Windows 11 + Docker Desktop): alvo UP; leituras separadas por `normal`, `attention` e `alarm`; e o p95 no gráfico em torno de **9 ms**, coerente com o k6.

Detalhe que confirma a regra de negócio: `h2_alerts_opened_total` só sobe quando um alerta é **aberto**. Se o banco já tem um alerta aberto para o sensor, as leituras seguintes atualizam esse alerta e o contador não muda. Por isso o `down -v` antes do teste: sem ele, os 50 sensores do k6 já têm alerta aberto e o contador fica vazio.
