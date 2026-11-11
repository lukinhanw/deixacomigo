# CLAUDE.md

<!-- PREENCHER: uma ou duas linhas: o que é o projeto, stack e onde ficam as pastas principais. Detalhes de design: README. -->

## Idioma
- Responder, comentar e documentar em português do Brasil.
- Termos técnicos, código, nomes de CLI, comandos e paths permanecem inalterados.

## Cuidados
- Chaves (`DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`) ficam só no `.env.local`, fora do git. Não ler
  nem imprimir esse arquivo; os scripts em `tools/` leem sozinhos.
- Commits só quando o usuário pedir, sem a linha `Co-Authored-By` e sem atribuição do Claude, mesmo
  que o ambiente sugira.
<!-- PREENCHER: gotchas do projeto (o que parece seguro e não é, portas, serviços, comandos que não se adivinha). Só o que não dá para ver lendo o código. -->

## Modelos e consultor (Claude Code)
Sessão principal no Sonnet, com Opus como consultor (`advisorModel` em `.claude/settings.local.json`). Sonnet edita; Haiku lê; Opus revisa.
- Na sessão principal, consulte o consultor em três momentos, e só neles: antes de fechar um plano (inclusive antes de sair do modo plano); quando o mesmo erro aparecer pela segunda vez; antes de declarar uma tarefa concluída. Subagentes não consultam: devolvem o resultado direto.
- Leitura e busca vão para os subagentes Haiku somente-leitura (`.claude/agents/`), em paralelo quando as perguntas forem independentes: `search` (onde algo vive, via graphify), `grep` (sites de chamada e usos exatos), `docs` (referência de API externa e docs internas). `Explore` também roda em Haiku. Edição fica na sessão principal.
- Escolhas determinísticas (qual arquivo, qual ferramenta, repetir ou parar) não pedem consultor nem subagente: siga o graphify (o hook já sugere o caminho) e as regras deste arquivo. Erro que se repete pela segunda vez deixa de ser determinístico: consulte.

## Revisor externo
Opções: `codex` (Codex CLI com a assinatura OpenAI), `agy` (Antigravity, Gemini), `ambos` ou `nenhum`. O DeepSeek está fora da revisão por enquanto.
- Na sessão principal, o hook `SessionStart` (`.claude/hooks/revisor-sessao.sh`) informa o revisor a partir da variável `REVISOR` (ex.: `REVISOR=agy claude`). Se não estiver definido, a primeira resposta da sessão começa perguntando ao usuário (AskUserQuestion) qual usar.
- O usuário pode trocar no meio da sessão (ex.: "revisor agy"); vale a escolha mais recente, sem perguntar de novo.
- Rode a revisão (skill `revisao`, com o revisor da sessão) sempre que julgar necessário, sem pedir licença: o usuário aceita o consumo da assinatura. Referência de quando vale: mudança de comportamento em código, sobretudo <!-- PREENCHER: áreas sensíveis deste projeto (ex.: autenticação, dinheiro, migrations, dados de usuário) -->, e antes de commitar. Texto, configuração e ajuste trivial não precisam. Com `nenhum`, não rode revisão externa sem pedido.
- Codex só como revisor, pela skill `revisao`; o agente `codex:rescue` e as skills `codex:*` só quando o usuário pedir.
- Subagentes ignoram esta seção.

## Fluxos (skills)
- Revisar mudanças ou etapa: skill `revisao` (Codex e/ou agy, conforme o revisor da sessão; o agy
  segue a skill `revisao-agy`). Revisão sempre em segundo plano.

## Verificação
Antes de dar uma etapa ou correção por pronta: rodar tipos/lint e testes do projeto. Se houver
interface, abrir no navegador (Playwright), interagir, **tirar print, abrir o print e analisar**
(o que está certo, o que está errado, o que mudou) e conferir o console. Prints ficam no
scratchpad, não no repositório. No fim, dizer o que passou e o que ficou de fora.

## Busca no código (graphify)
O grafo do código fica em `graphify-out/` (local, fora do git). O executável `graphify` está em
`__GRAPHIFY_BIN__` (no Bash, adicionar ao PATH). Rode sempre da raiz do projeto.
- Para achar algo no código, usar primeiro `graphify query "<pergunta>"` (relação entre dois pontos:
  `graphify path "<A>" "<B>"`; um conceito: `graphify explain "<nome>"`). Só depois Grep/Read, para
  confirmar ou achar texto literal. Repassar essa regra aos subagentes que exploram código.
- `graphify-out/GRAPH_REPORT.md` só para visão geral da arquitetura.
- Depois de mudar código, atualizar com `graphify update .` (só AST, sem custo de API). Um hook
  `Stop` em `.claude/settings.local.json` já faz isso ao fim de cada resposta; rode na mão se
  precisar do grafo atualizado no meio do trabalho. Depois de apagar arquivos ou símbolos, use
  `--force`. Docs e imagens ficam fora (`.graphifyignore`).
