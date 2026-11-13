---
name: revisao
description: Revisão do projeto com o revisor da sessão — agy (Antigravity, padrão) ou sonnet (subagente `revisor`, reserva) — e depois triagem com prova. Use ao revisar uma etapa, um conjunto de mudanças ou antes de commitar.
---

# Revisão externa

Revisores: `agy` (padrão), `sonnet` (reserva) ou `nenhum` (seção "Revisor" do CLAUDE.md). O Codex não é mais usado.
Use o revisor da sessão (o padrão vem de `REVISOR` em `.claude/settings.local.json`); não pergunte qual usar.
O DeepSeek (`tools/codex-deepseek.sh`, `tools/revisar-deepseek.mjs`) está fora por enquanto: não rode.

## 1. Preparar

- Se o projeto tiver repositórios git aninhados ou independentes (ex.: `back/` e `front/`), revise cada um dentro da própria pasta.
- Não use `git add -N` nem `git reset` por causa da revisão: os scripts leem as mudanças sem mexer no índice.
- Base: `--uncommitted` se nada foi commitado; senão o commit anterior à etapa.

## 2. Rodar (Bash, sempre com `run_in_background`)

- **sonnet** (reserva, ou se o usuário pedir): gera os pacotes e chama o subagente `revisor` (Sonnet, contexto limpo, só leitura) com o caminho de cada um:
  `node tools/montar-pacote.mjs --out <scratchpad>/revisao` (com `--repo <pasta>` para cada repositório aninhado) imprime uma linha por
  pacote; um `Agent` com `subagent_type: revisor` por pacote (em paralelo se forem vários e independentes). Não repasse o raciocínio do
  autor: o revisor não vê a conversa de propósito. Nada de `git add -N` aqui. Cada achado vem com "Prova" (teste ou comando): rode a prova para triar.
- **agy**: siga a skill `revisao-agy`: `node tools/revisar-agy.mjs --out <scratchpad>/revisao` (Gemini, assinatura
  do Antigravity). O script fecha o escopo, limita as ferramentas e nunca devolve saída vazia em silêncio. Se falhar (503/429, timeout, login expirado), rode o sonnet no mesmo pacote.

## 3. Triagem

- Cada achado é uma hipótese: confirme lendo o código e, quando der, prove com teste (script no
  scratchpad, teste ou o navegador).
- O que contradiz uma regra do CLAUDE.md é decisão de design: relate ao usuário em vez de mudar.
- Depois das correções, rode a verificação descrita no CLAUDE.md (testes, lint, build).

## Falsos positivos já vistos neste projeto

Acrescente aqui, com uma linha cada, o que os revisores acusaram e a prova mostrou ser falso:
- (nenhum ainda)
