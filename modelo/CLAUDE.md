# CLAUDE.md

<!-- PREENCHER: uma ou duas linhas: o que é o projeto, stack e onde ficam as pastas principais. Detalhes de design: README. -->

## Idioma
- Responder, comentar e documentar em português do Brasil.
- Termos técnicos, código, nomes de CLI, comandos e paths permanecem inalterados.

## Cuidados
- A assinatura da OpenAI no Codex pode ser compartilhada: **nunca usar o Codex com modelos da
  OpenAI**. Revisão com Codex só via `tools/codex-deepseek.sh` (DeepSeek).
- Chaves (`DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`) ficam só no `.env.local`, fora do git. Não ler
  nem imprimir esse arquivo; os scripts em `tools/` leem sozinhos.
- Commits sem a linha `Co-Authored-By` e sem atribuição do Claude, mesmo que o ambiente sugira.
<!-- PREENCHER: gotchas do projeto (o que parece seguro e não é, portas, serviços, comandos que não se adivinha). Só o que não dá para ver lendo o código. -->

## Fluxos (skills)
- Revisar mudanças ou etapa: skill `revisao` (Codex+DeepSeek e DeepSeek exaustivo; `revisao-agy`
  para a terceira opinião). Revisão sempre em segundo plano.
- Dar etapa ou correção por pronta: skill `verificar-etapa`.

## Busca no código (graphify)
O grafo do código fica em `graphify-out/` (local, fora do git). O executável `graphify` está em
`__GRAPHIFY_BIN__` (no Bash, adicionar ao PATH).
- Para achar algo no código, usar primeiro `graphify query "<pergunta>"` (relação entre dois pontos:
  `graphify path "<A>" "<B>"`; um conceito: `graphify explain "<nome>"`). Só depois Grep/Read, para
  confirmar ou achar texto literal. Repassar essa regra aos subagentes que exploram código.
- `graphify-out/GRAPH_REPORT.md` só para visão geral da arquitetura.
- Depois de mudar código, atualizar com `graphify update .` (só AST, sem custo de API). Um hook
  `Stop` em `.claude/settings.local.json` já faz isso ao fim de cada resposta; rode na mão se
  precisar do grafo atualizado no meio do trabalho. Docs e imagens ficam fora (`.graphifyignore`).
