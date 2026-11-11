# deixacomigo

Kit para deixar um projeto pronto para trabalhar com o Claude Code do mesmo jeito: regras enxutas no
`CLAUDE.md`, busca no código por grafo (**graphify**, com hooks que mantêm o grafo atualizado),
**modelos e consultor** (Sonnet na sessão, Opus como consultor, subagentes Haiku só de leitura),
**revisão externa** (Codex com a assinatura OpenAI e/ou Antigravity, à escolha na sessão) e a regra de verificação
antes de dar algo por pronto.

## Como ativar

Abra o projeto no Claude Code (ou em outra IA com acesso a terminal) e diga:

> Ative o deixacomigo: clone https://github.com/lukinhanw/deixacomigo em `~/.deixacomigo` (ou
> atualize se já existir) e siga o `INSTALAR.md`.

Depois da primeira vez, a skill global `deixacomigo` fica instalada e basta dizer
**"ativar o deixacomigo"** em qualquer projeto.

**Agente: leia [INSTALAR.md](INSTALAR.md) e siga o roteiro. Não pule o passo de preencher os `PREENCHER`.**

## O que entra no projeto

| Item | O que é |
| --- | --- |
| `CLAUDE.md` | Idioma, cuidados (chaves, commits sem `Co-Authored-By`), modelos e consultor, revisor externo, fluxos e regra de busca pelo graphify |
| `.graphifyignore` | O que o grafo ignora |
| `.claude/agents/` | Subagentes Haiku somente-leitura: `search`, `grep`, `docs` e `Explore` |
| `.claude/hooks/revisor-sessao.sh` | Hook `SessionStart`: informa o revisor da sessão (variável `REVISOR`); sem ela, o Claude pergunta |
| `tools/revisao-contexto.md` | Descrição do projeto que os revisores recebem |
| `.claude/skills/revisao`, `revisao-agy` | Fluxos de revisão externa (Codex e/ou agy) |
| `tools/codex-deepseek.sh`, `tools/revisar-deepseek.mjs` | Revisão com DeepSeek. **Fora da revisão por enquanto**; ficam no kit para uso futuro |
| `.claude/settings.local.json` | Modelo (`sonnet`) e consultor (`opus`) se o projeto ainda não os definiu; hooks do graphify (consulta antes de buscar, atualiza ao fim de cada resposta) e do revisor |
| `.env.local` | Chaves `DEEPSEEK_API_KEY` e `OPENROUTER_API_KEY` (vazias; fora do git). Só servem ao DeepSeek |

## Pré-requisitos

Obrigatórios: `git`, `node`, `python` 3 com `pip`. Opcionais: `codex` (revisão Codex, com
`codex login`) e `agy` (Antigravity). O instalador avisa o que faltar. Nenhuma chave de API é
necessária.

## Segurança

- Chaves só no `.env.local` de cada projeto, nunca no kit nem no git.
- O instalador nunca sobrescreve arquivos existentes e nunca grava em `.claude/settings.json`. A única
  exceção é o `.claude/settings.local.json`, que ele mescla: troca o hook `Stop` antigo
  (`graphify update .`, sem `cd`) pelo novo, preserva os hooks do usuário e só grava `model` e
  `advisorModel` se ainda não existirem.
- Nenhum commit é feito sem pedido.

## Atualizar

`git -C ~/.deixacomigo pull` e peça **"ativar o deixacomigo"** no projeto. O instalador sozinho só
acrescenta o que falta e atualiza o `settings.local.json`: `CLAUDE.md`, skills e agentes que o
projeto já tinha ficam como estão, e o instalador avisa quando eles forem de uma versão antiga. O agente
mescla pelo passo 2 do `INSTALAR.md`.
