# deixacomigo

Kit para deixar um projeto pronto para trabalhar com o Claude Code do mesmo jeito: regras enxutas no
`CLAUDE.md`, busca no código por grafo (**graphify**, com hooks que mantêm o grafo atualizado),
**revisão externa** (Codex + DeepSeek, DeepSeek exaustivo e Antigravity) e a skill
**verificar-etapa**.

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
| `CLAUDE.md` | Idioma, cuidados (Codex só com DeepSeek, chaves, commits sem `Co-Authored-By`), fluxos e regra de busca pelo graphify |
| `.graphifyignore` | O que o grafo ignora |
| `tools/codex-deepseek.sh` | Revisão do Codex usando a DeepSeek como modelo (sem gastar a assinatura da OpenAI) |
| `tools/revisar-deepseek.mjs` | Revisão exaustiva (diff + arquivos inteiros) pela API da DeepSeek |
| `tools/revisao-contexto.md` | Descrição do projeto que os revisores recebem |
| `.claude/skills/revisao`, `revisao-agy`, `verificar-etapa` | Fluxos de revisão e verificação |
| `.claude/settings.local.json` | Hooks do graphify (consulta antes de buscar, atualiza ao fim de cada resposta) |
| `.env.local` | Chaves `DEEPSEEK_API_KEY` e `OPENROUTER_API_KEY` (vazias; fora do git) |

## Pré-requisitos

Obrigatórios: `git`, `node`, `python` 3 com `pip`. Opcionais: `codex` (revisão Codex), `agy`
(Antigravity) e uma chave da DeepSeek. O instalador avisa o que faltar.

## Segurança

- Chaves só no `.env.local` de cada projeto, nunca no kit nem no git.
- O instalador nunca sobrescreve arquivos existentes e nunca grava em `.claude/settings.json`.
- Nenhum commit é feito sem pedido.

## Atualizar

`git -C ~/.deixacomigo pull` e rode o instalador de novo no projeto.
