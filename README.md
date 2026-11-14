**Nível: B** · Projeto final Full Cycle · Individual · Ednardo Pinheiro Peixoto

# H2VSENSE Alerts API

[![CI](https://github.com/EDNARDOPPEIXOTO99/h2vsense-alerts-api/actions/workflows/ci.yml/badge.svg)](https://github.com/EDNARDOPPEIXOTO99/h2vsense-alerts-api/actions/workflows/ci.yml)

API que recebe leituras de sensores de hidrogênio (H2) e transforma leituras perigosas em **alertas de vazamento** para o operador. É o backend de domínio único do H2VSENSE, a minha startup de detecção de vazamento de H2 com IoT e TinyML.

## O problema

Num eletrolisador ou compressor de hidrogênio, um vazamento vira risco de explosão a partir de **4% de H2 no ar** (o Limite Inferior de Explosividade, LIE = 40.000 ppm). O sensor mede ppm; o operador precisa de **um alerta claro, sem duplicação, que não some sozinho**.

## Fluxo principal (ponta a ponta)

```
sensor ──POST /readings──▶ classifica (% do LIE) ──▶ grava leitura
                                   │
                         atenção/alarme?
                                   │ sim
                                   ▼
               existe alerta aberto do sensor? ── não ──▶ abre alerta
                                   │ sim
                                   ▼
                     atualiza (pico, contagem) e escala se piorou
                                   │
operador ──GET /alerts?status=open──▶ vê ──PATCH /alerts/:id/ack──▶ reconhece
```

| Faixa | Limite | % do LIE |
|---|---|---|
| normal | < 4.000 ppm | < 10% |
| atenção (`attention`) | ≥ 4.000 ppm | 10% |
| alarme (`alarm`) | ≥ 10.000 ppm | 25% |

Regras de negócio:

1. Um sensor tem **no máximo um alerta aberto** (garantido no código e por índice único parcial no banco).
2. Leitura mais grave **escala** o alerta; nunca rebaixa a severidade nem o pico.
3. Leitura normal **não fecha** o alerta. Só o reconhecimento de um operador encerra (segurança primeiro).
4. Leituras simultâneas do mesmo sensor são serializadas (transação + advisory lock por sensor): nada de alerta duplicado nem contagem perdida.

## Como subir (1 comando)

Pré-requisito: Docker Desktop.

```bash
docker compose up --build
```

A API sobe em `http://localhost:3000` já com o Postgres e as migrações aplicadas. Os valores padrão do Compose são só para desenvolvimento local; para trocar senha/portas, copie `.env.example` para `.env` e ajuste.

Com Prometheus junto (opcional):

```bash
docker compose --profile observability up --build   # Prometheus em http://localhost:9090
```

### Experimentar

```bash
# leitura normal
curl -X POST localhost:3000/readings -H "Content-Type: application/json" \
  -d '{"sensorId":"ELETROLISADOR-01","ppm":800}'

# alarme: abre o alerta
curl -X POST localhost:3000/readings -H "Content-Type: application/json" \
  -d '{"sensorId":"ELETROLISADOR-01","ppm":13500}'

# alertas abertos
curl "localhost:3000/alerts?status=open"

# reconhecer (troque <id>)
curl -X PATCH localhost:3000/alerts/<id>/ack -H "Content-Type: application/json" \
  -d '{"acknowledgedBy":"operador.turno-a"}'
```

No PowerShell do Windows, use `curl.exe` e aspas simples externas no `-d`.

## Como testar

```bash
npm ci
npm run lint
npm test                 # unitários (+ integração se DATABASE_URL existir)
npm run test:coverage    # falha abaixo do mínimo declarado
```

O **teste de integração** usa Postgres real. Localmente, suba só o banco e aponte a variável:

```bash
docker compose up -d db
# bash
DATABASE_URL=postgres://h2vsense:h2vsense_local@localhost:5432/h2vsense npm test
# PowerShell
$env:DATABASE_URL="postgres://h2vsense:h2vsense_local@localhost:5432/h2vsense"; npm test
```

No CI ele roda sempre, contra um service container do Postgres.

**Porta 5432 ocupada?** Se você já tem um PostgreSQL instalado na máquina (comum no Windows), o teste cai nele e falha com erro de senha. Exponha o banco do Compose em outra porta e use a mesma porta na variável:

```powershell
"DB_PORT=55432" | Out-File -Encoding ascii .env
docker compose up -d
$env:DATABASE_URL="postgres://h2vsense:h2vsense_local@localhost:55432/h2vsense"; npm run test:coverage
```

**Coverage mínimo declarado** (em `vitest.config.ts`, aplicado no CI): linhas 80%, statements 80%, funções 80%, branches 75%. Atual: ~93% de linhas.

**Smoke test de desempenho** (com a API no ar):

```bash
k6 run k6/smoke.js
```

Última medição (Windows 11 + Docker Desktop, 10 VUs por 30 s): **p95 de 9,28 ms** no `POST /readings` (SLO: < 200 ms), 0% de erro em 2.853 requisições e nenhum alerta duplicado ou contagem perdida no banco. Resultado e análise em [`docs/desempenho.md`](docs/desempenho.md).

## Rodar sem Docker (desenvolvimento)

```bash
cp .env.example .env     # ajuste DATABASE_URL
npm ci
npm run dev              # aplica migrações no boot e recarrega ao salvar
```

## Endpoints

| Método | Rota | O quê |
|---|---|---|
| POST | `/readings` | Registra leitura e abre/atualiza alerta (fluxo principal) |
| GET | `/alerts` | Lista alertas (`status`, `sensorId`, `limit`) |
| PATCH | `/alerts/:id/ack` | Operador reconhece o alerta |
| GET | `/health` | Saúde da API + banco |
| GET | `/metrics` | Métricas Prometheus |

Contrato completo: [`docs/openapi.yaml`](docs/openapi.yaml) (OpenAPI 3.1, validado com Spectral no CI). Para visualizar, cole o arquivo em <https://editor.swagger.io>.

## Arquitetura e design

```
src/
├─ domain/          regras puras: Severity, ClassificationPolicy (Strategy), Reading, Alert, portas
├─ application/     casos de uso: IngestReading, ListAlerts, AcknowledgeAlert
├─ infra/
│  ├─ postgres/     Repository Postgres (único lugar com SQL)
│  ├─ memory/       Repository em memória (testes unitários)
│  └─ db/           pool e migrações SQL
├─ http/            Express: rotas, validação (zod), tradução de erros
├─ observability/   logger (pino) e métricas (prom-client)
├─ container.ts     composition root: único lugar que conhece as implementações
└─ server.ts        boot
```

**Pattern justificado: Strategy** (`ClassificationPolicy`). Os limites de alarme mudam por cliente, por norma e por tipo de sensor. O caso de uso só conhece a interface; a política padrão é `LelThresholdPolicy` (10%/25% do LIE, configuráveis por variável de ambiente). Para um cliente com regra diferente (ex. média móvel, ou limite absoluto em ppm), crio outra classe e troco em `container.ts`, sem tocar na ingestão.

Apoio: **Repository**, que isola o SQL e me permite testar os casos de uso em memória.

**SOLID na prática:**

- **S**: cada caso de uso tem um motivo para mudar; HTTP só traduz, não decide.
- **O**: nova política de classificação = nova classe, sem editar `IngestReading`.
- **L**: repositórios Postgres e memória são intercambiáveis (os testes provam).
- **I**: portas pequenas (`ReadingRepository`, `AlertRepository`, `AlertMetrics`, `Clock`).
- **D**: o domínio depende de interfaces; `container.ts` injeta as concretas.

Decisão registrada: [`docs/adr/0001-postgresql-para-leituras-e-alertas.md`](docs/adr/0001-postgresql-para-leituras-e-alertas.md).

## Operação

- **Configuração só por ambiente**, validada no boot com zod (a API não sobe com config inválida). Modelo em `.env.example`; `.env` está no `.gitignore`.
- **Segredos fora do repositório**; o CI roda **gitleaks** em todo push.
- **Logs estruturados** em JSON (pino), com id da requisição (`req.id`), nível configurável e cabeçalhos sensíveis mascarados. Abrir ou escalar alerta gera log `warn`.
- **Métricas** em `/metrics`: `h2_alerts_opened_total{severity}` (negócio), `h2_readings_ingested_total{severity}` e `http_request_duration_seconds` (latência por rota).
- **SLO**: 95% das requisições `POST /readings` em menos de **200 ms** (janela de 28 dias). Detalhes em [`docs/observabilidade.md`](docs/observabilidade.md).

## CI

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) roda em push e PR:

1. `npm ci` → lint (zero warnings) → typecheck → testes com coverage mínimo → build, com Postgres real.
2. Lint do contrato OpenAPI (Spectral).
3. Varredura de segredos (gitleaks).

## Documentação

| Arquivo | Conteúdo |
|---|---|
| [`docs/adr/0001-...md`](docs/adr/0001-postgresql-para-leituras-e-alertas.md) | ADR: PostgreSQL × banco de séries temporais |
| [`docs/openapi.yaml`](docs/openapi.yaml) | Contrato da API |
| [`docs/desempenho.md`](docs/desempenho.md) | Smoke test k6 e p95 medido |
| [`docs/observabilidade.md`](docs/observabilidade.md) | Logs, métricas e SLO |
| [`docs/ia.md`](docs/ia.md) | Uso de IA e prompts que importaram |
| [`docs/README.md`](docs/README.md) | Índice da pasta `docs/` |
| [`CONTRIBUTORS.md`](CONTRIBUTORS.md) | Quem fez o quê |

## Limitações conhecidas

- Sem autenticação: num deploy real, sensores usariam token por dispositivo e operadores, login. Fica para a próxima versão.
- Leituras crescem sem limite; em produção eu adicionaria retenção/particionamento por tempo (ver ADR).
