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
- O objetivo é economizar tokens: delegar só compensa quando a leitura é grande ou incerta. Um subagente custa briefing, espera e resumo; para um trecho curto, ler direto sai mais barato.
- Vai para subagente (`search`/`grep`/`docs`, em paralelo se independentes) a leitura ampla ou incerta: não sei onde algo vive, o fluxo atravessa vários arquivos ou módulos, ou só a conclusão interessa.
- Leia direto na sessão principal quando o alvo já é conhecido e o trecho é curto, sempre com `offset`/`limit` ou `graphify explain` para achar as linhas; nunca arquivo grande inteiro. Isso inclui o arquivo que será editado em seguida (a edição exige o texto literal no contexto).
- Não releia o que já está no contexto nem peça a um subagente algo que a conversa já respondeu.

## Revisor
O revisor padrão é o `agy` (Antigravity CLI; o script usa `gemini-4-hydrogen-medium`, ajuste com `--model`), fixado por `REVISOR=agy` em `.claude/settings.local.json`. Se o agy falhar (503/429, timeout, login expirado), use o `sonnet` (subagente interno `revisor`, contexto limpo) no mesmo pacote. Outras opções: `sonnet` e `nenhum`. **O Codex não é mais usado** para revisão, e o DeepSeek também está fora: não os ofereça nem pergunte por eles.
- Na sessão principal, o hook `SessionStart` (`.claude/hooks/revisor-sessao.sh`) informa o revisor a partir da variável `REVISOR` (ex.: `REVISOR=agy claude`). O padrão já vem definido, então não pergunte qual revisor usar no começo da sessão.
- O usuário pode trocar no meio da sessão (ex.: "revisor agy"); vale a escolha mais recente, sem perguntar de novo.
- Rode a revisão (skill `revisao`, com o revisor da sessão) sempre que julgar necessário, sem pedir licença: o usuário aceita o consumo (no `sonnet` de reserva, são tokens do Claude: ~100 mil por pacote grande, medido). Referência de quando vale: mudança de comportamento em código, sobretudo <!-- PREENCHER: áreas sensíveis deste projeto (ex.: autenticação, dinheiro, migrations, dados de usuário) -->, e antes de commitar. Texto, configuração e ajuste trivial não precisam. Com `nenhum`, não rode revisão sem pedido.
- Pacote para o `sonnet` (e para o agy, que usa o mesmo): monte o pacote (`node tools/montar-pacote.mjs --out <scratchpad>/revisao`, com `--repo <pasta>` por repositório aninhado) e chame o subagente `revisor` com o caminho de cada pacote; triar pela "Prova" de cada achado (rodar o teste ou comando) em vez de reler o código. O revisor não vê a conversa de propósito: não repasse o raciocínio do autor.
- Não use o agente `codex:rescue` nem as skills `codex:*`.
- Subagentes ignoram esta seção.

## Fluxos (skills)
- Revisar mudanças ou etapa: skill `revisao` (agy por padrão, que segue a skill `revisao-agy`; `sonnet` de reserva). Revisão sempre em segundo plano.

## Verificação
Antes de dar uma etapa ou correção por pronta: rodar tipos/lint e testes do projeto. Se houver
interface, abrir no navegador (Playwright), interagir, **tirar print, abrir o print e analisar**
(o que está certo, o que está errado, o que mudou) e conferir o console. Prints ficam no
scratchpad, não no repositório. No fim, dizer o que passou e o que ficou de fora.

## Busca no código (graphify)
O grafo do código fica em `graphify-out/` (local, fora do git). O executável `graphify` está em
`__GRAPHIFY_BIN__` (no Bash, adicionar ao PATH). Rode sempre da raiz do projeto.
- Sempre procure no graphify antes de explorar o código: `graphify query "<pergunta>"` (relação entre
  dois pontos: `graphify path "<A>" "<B>"`; um conceito: `graphify explain "<nome>"`; impacto:
  `graphify affected`). Ele aponta arquivo e linhas por muito menos tokens que ler ou buscar. Só depois
  Grep/Read, para confirmar ou achar texto literal, lendo só o trecho (offset/limit). Só dispense a
  consulta para um caminho e linhas já obtidos na conversa. Repassar essa regra aos subagentes.
- O hook `.claude/hooks/graphify-primeiro.py` bloqueia `Read`/`Grep`/`Glob` e buscas `grep`/`rg`/`find`
  no Bash até a primeira consulta ao graphify da sessão (docs, `.claude/`, `tools/` e arquivos fora do
  projeto passam). Faça a consulta e siga; não contorne.
- `graphify-out/GRAPH_REPORT.md` só para visão geral da arquitetura.
- Depois de mudar código, atualizar com `graphify update .` (só AST, sem custo de API). Um hook
  `Stop` em `.claude/settings.local.json` já faz isso ao fim de cada resposta, mas não no meio dela:
  se criar ou mover arquivos e símbolos e for consultar o graphify na mesma resposta, rode
  `graphify update .` antes (da raiz). Depois de apagar arquivos ou símbolos, use `--force`. Se
  aparecer `graphify-out/graph.html`, apague. Docs e imagens ficam fora (`.graphifyignore`).
