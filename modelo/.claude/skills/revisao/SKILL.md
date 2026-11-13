---
name: revisao
description: Revisão do projeto com o revisor escolhido na sessão — sonnet (subagente `revisor`, padrão), agy (Antigravity) ou Codex quando existir — e depois triagem com prova. Use ao revisar uma etapa, um conjunto de mudanças ou antes de commitar.
---

# Revisão externa

Revisores: `sonnet`, `agy`, `codex`, `ambos` ou `nenhum` (escolha e troca: seção "Revisor" do CLAUDE.md).
Use o revisor da sessão; se ainda não houver um, pergunte ao usuário antes de rodar.
O DeepSeek (`tools/codex-deepseek.sh`, `tools/revisar-deepseek.mjs`) está fora por enquanto: não rode.

## 1. Preparar

- Se o projeto tiver repositórios git aninhados ou independentes (ex.: `back/` e `front/`), revise cada um dentro da própria pasta.
- Só para o Codex: arquivo novo precisa estar no índice (`git add -N`) para aparecer no diff (o script do agy dispensa isso). Se usar, desfaça com `git reset -- <arquivos>` antes de commitar ou limpar.
- Base: `--uncommitted` se nada foi commitado; senão o commit anterior à etapa.

## 2. Rodar (Bash, sempre com `run_in_background`; com `ambos`, os dois em paralelo)

- **sonnet** (padrão): gera os pacotes e chama o subagente `revisor` (Sonnet, contexto limpo, só leitura) com o caminho de cada um:
  `node tools/montar-pacote.mjs --out <scratchpad>/revisao` (com `--repo <pasta>` para cada repositório aninhado) imprime uma linha por
  pacote; um `Agent` com `subagent_type: revisor` por pacote (em paralelo se forem vários e independentes). Não repasse o raciocínio do
  autor: o revisor não vê a conversa de propósito. Nada de `git add -N` aqui. Cada achado vem com "Prova" (teste ou comando): rode a prova para triar.
- **Codex** (só se houver a assinatura; modelo padrão do `~/.codex/config.toml`, assinatura OpenAI), dentro do repositório:
  `cd <repositório> && codex review --uncommitted > <scratchpad>/revisao/codex.md 2> <scratchpad>/revisao/codex.err`
  Já commitado: `--base <branch>` ou `--commit <SHA>`. O Codex lê o `AGENTS.md` do repositório, se houver;
  um projeto só com `CLAUDE.md` não passa as regras a ele. O `codex review` aceita um `[PROMPT]` com
  instruções customizadas (ex.: apontar o `CLAUDE.md`); não foi testado junto com `--uncommitted`.
  Leva de 5 a 15 min. Se falhar por login, avise o usuário (`codex login`). O sandbox do Codex pode negar o
  Docker: ele revisa o código, mas não roda os testes.
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
