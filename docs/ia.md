# Uso de IA

Usei o **Claude** (Anthropic) como par de programação neste projeto. Declaro aqui o que importou: os prompts, o que a IA sugeriu e o que eu decidi.

## Prompts que importaram

1. **Entender as diretrizes.** Passei o link da aula 24 e pedi um resumo dos requisitos do Projeto A e do Projeto B, da rubrica e do que mais derruba nota.

2. **Escolha do nível e do domínio.** Informei que o projeto seria individual, nível B, e ligado ao H2VSENSE, e pedi uma sugestão de domínio único. A IA sugeriu "ingestão de leituras de sensores de H2 e gestão de alertas de vazamento", com faixas em % do LIE do hidrogênio. **Decisão minha:** aceitei, porque é o problema real da minha startup e o fluxo cabe em 8 dias.

3. **Geração da base do projeto.** Pedi o repositório completo do nível B: código, testes, CI, Compose, ADR, OpenAPI, k6 e documentação, em Node + TypeScript.

## O que a IA sugeriu e o que eu decidi

| Tema | Sugestão | Minha decisão |
|---|---|---|
| Pattern | Strategy para a política de classificação | **Aceitei.** Limites de alarme mudam por cliente e norma; é o ponto que mais vai variar no produto. |
| Banco | PostgreSQL, com Influx/Timescale como alternativas | **Aceitei Postgres** e registrei no ADR 0001 por que descartei o Influx agora. |
| Acesso a dados | Prisma na proposta inicial; ao montar o projeto, a IA usou `pg` direto + Repository | **Mantive `pg` direto + Repository.** Menos dependências e SQL explícito, que eu consigo explicar linha a linha. |
| Concorrência | A primeira versão buscava o alerta aberto e depois atualizava, sem proteção | **Corrigi** quando o problema apareceu na revisão da primeira versão: duas leituras simultâneas do mesmo sensor podiam perder contagem. Passei para transação + `pg_advisory_xact_lock` por sensor, mantendo o índice único parcial como rede de segurança. Escrevi um teste de integração que prova isso com 10 requisições simultâneas. |
| Fechar alerta | Alerta só encerra com reconhecimento do operador, nunca sozinho | **Aceitei.** Em segurança industrial um vazamento intermitente não pode "sumir sozinho". |
| Limites | 10% e 25% do LIE do H2 | **Aceitei** como padrão e deixei configurável por ambiente (`ATTENTION_PCT_LEL`, `ALARM_PCT_LEL`). |

## Como eu validei

- Rodei lint, typecheck e todos os testes (unitários + integração com Postgres real).
- Rodei o smoke test k6 e conferi no banco que não houve alerta duplicado nem contagem perdida.
- Validei o contrato OpenAPI com Spectral e varri o repositório com gitleaks.
- Li e consigo explicar cada arquivo; onde não concordei, mudei.
