# Desempenho

## O que eu medi

Smoke test do fluxo principal (`POST /readings`) com k6, para confirmar que a API aguenta carga leve sem erro e dentro do SLO (p95 < 200 ms).

Script: [`k6/smoke.js`](../k6/smoke.js)

| Parâmetro | Valor |
|---|---|
| Usuários virtuais | 10 |
| Duração | 30 s |
| Pausa por iteração | 100 ms |
| Sensores simulados | 50 |
| Mistura de leituras | ~90% normal, ~8% atenção, ~2% alarme |
| Thresholds | `p(95)<200` ms, falhas < 1%, checks > 99% |

## Ambiente da medição

| | |
|---|---|
| SO | Windows 11, Docker Desktop (WSL 2) |
| API | Em container, subida com `docker compose up -d` (imagem de produção, `node dist/server.js`) |
| Banco | PostgreSQL 16 em container, banco zerado antes do teste (`docker compose down -v`) |
| k6 | Na mesma máquina, fora do Docker |

## Resultado (2026-11-14)

| Métrica | Valor |
|---|---|
| Requisições | 2.853 (~95 req/s) |
| Falhas HTTP | 0,00% (0 de 2.853) |
| Checks | 100% (5.706 de 5.706) |
| Latência média | 4,65 ms |
| Mediana | 3,29 ms |
| p90 | 7,04 ms |
| **p95** | **9,28 ms** ✅ (SLO: < 200 ms) |
| p99 | 27,34 ms |
| Máxima | 134,9 ms |

Os três thresholds passaram: `p(95)<200`, `http_req_failed < 1%` e `checks > 99%`.

## Leitura dos números

- O p95 de ~9 ms está cerca de **20 vezes abaixo** do alvo de 200 ms. Para o volume desta fase (dezenas de sensores), a API não é gargalo.
- A máxima de ~135 ms é um caso isolado do início do teste (aquecimento do pool de conexões e do JIT do Node). O p99 já fica em ~27 ms.
- Rodando em container no Docker Desktop, a latência é maior do que rodando o Node direto no sistema. Isso é esperado por causa da camada de rede do WSL 2, e mesmo assim o SLO sobra com folga.
- O caminho mais caro é a leitura anormal: abre transação, pega o advisory lock do sensor e faz até 2 queries extras. Como só ~10% das leituras são anormais, o custo médio quase não muda.

## Consistência depois da carga

O teste dispara leituras simultâneas para 50 sensores. Para conferir que não houve alerta duplicado nem contagem perdida, rodo logo depois do k6:

```powershell
docker compose exec db psql -U h2vsense -d h2vsense `
  -c "select severity, count(*) from readings group by 1 order by 1;" `
  -c "select count(*) as alertas, sum(readings_count) as leituras_nos_alertas from alerts;" `
  -c "select count(*) as sensores_duplicados from (select sensor_id from alerts where status='open' group by 1 having count(*)>1) x;"
```

O esperado: a soma de `readings_count` nos alertas é igual ao total de leituras `attention` + `alarm`, e `sensores_duplicados` = 0. A mesma regra é garantida pelo teste de integração com 10 requisições simultâneas no mesmo sensor.

Resultado depois do k6 de 2026-11-14:

| Conferência | Valor |
|---|---|
| Leituras gravadas | 2.853 (2.541 normal, 259 atenção, 53 alarme), igual ao total de requisições do k6 |
| Alertas abertos | 50 (um por sensor simulado) |
| Leituras contadas nos alertas | 312 = 259 + 53 ✅ **nenhuma contagem perdida** |
| Sensores com mais de um alerta aberto | 0 ✅ **nenhum alerta duplicado** |

## O que eu faria diferente / próximos passos

1. **Teste de carga de verdade** (rampa até quebrar) para achar o limite, com o k6 em outra máquina. Este smoke test mede só "funciona bem em carga leve".
2. **Pior caso de contenção:** muitos usuários virtuais no **mesmo** sensor ao mesmo tempo. O advisory lock serializa esse sensor, então a latência dele sobe; quero medir quanto.
3. **Volume:** repetir com milhões de linhas em `readings` para validar o índice `(sensor_id, measured_at)` e o gatilho do ADR 0001.

## Como reproduzir

```bash
docker compose down -v
docker compose up -d
k6 run k6/smoke.js
```

Instalar k6 no Windows: `winget install k6 --source winget`.
