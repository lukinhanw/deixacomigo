# INSTALAR.md — roteiro para o agente

Você é o agente que recebeu o pedido "ativar o deixacomigo" num projeto. Este arquivo é o roteiro
completo. Siga na ordem, sem pedir confirmação a cada passo (só onde indicado). Responda em
português do Brasil.

O kit instala no projeto atual: regras (`CLAUDE.md`), modelos e consultor (Sonnet na sessão, Opus
como consultor, subagentes Haiku em `.claude/agents/`), busca por grafo (graphify com hooks),
revisão externa (agy por padrão, com o Sonnet de reserva) e a regra de
verificação antes de dar por pronto.

## 0. Onde está o kit

O kit vive em `~/.deixacomigo`. Se não existir: `git clone https://github.com/lukinhanw/deixacomigo ~/.deixacomigo`.
Se existir: `git -C ~/.deixacomigo pull --ff-only`. (Windows: `~` = pasta do usuário.)

## 1. Rodar a parte automática

Na raiz do projeto (precisa ser um repositório git; se não for, `git init`):

```bash
node ~/.deixacomigo/instalar.mjs .
```

Ele instala o graphify, copia os arquivos de `modelo/` **sem sobrescrever nada**, ajusta o
`.gitignore`, gera o grafo e grava em `.claude/settings.local.json` os hooks do graphify e do revisor
(`SessionStart`), além de `model: sonnet` e `advisorModel: opus` quando o projeto ainda não os
definia. No fim imprime um JSON: `copiados`, `pulados`, `avisos`, `erros`, `placeholders`, `grafo`,
`modelos` (o que gravou ou manteve em `model`/`advisorModel`), `graphifyDir`.
Se `erros` não estiver vazio, corrija a causa (ele diz qual) e rode de novo: é idempotente.

## 2. Preencher o que é específico do projeto

Leia README, manifesto (`package.json`, `pyproject.toml`, …) e a estrutura de pastas. Depois
procure `PREENCHER` (a lista está em `placeholders`) e substitua cada marcador por conteúdo real,
apagando o comentário:

- **CLAUDE.md**: 1 a 2 linhas do que é o projeto; gotchas que **não dá para ver lendo o código**
  (portas, serviços, comandos não óbvios, armadilhas). Não copie estrutura de pastas, lista de
  dependências nem comandos padrão: a sessão deduz sozinha. Na seção "Revisor externo", preencha as
  áreas sensíveis do projeto (onde uma revisão externa vale mesmo: autenticação, dinheiro,
  migrations, dados de usuário…).
- **.claude/agents/**: já vêm genéricos (`search`, `grep`, `docs`, `Explore`, todos Haiku). Se o
  projeto tiver estrutura que muda a busca (repositórios aninhados, pasta de docs específica), acrescente
  uma linha no agente correspondente; senão deixe como está.
- **tools/revisao-contexto.md**: 2 a 5 linhas para o revisor (o que é, stack com versões,
  arquitetura). Os revisores externos não veem o repositório inteiro, só isso e o diff.
- **Verificação**: a regra geral já está no CLAUDE.md. Se o projeto tiver um fluxo de verificação
  que não se adivinha (serviços para subir, portas, seletores, passos em ordem), crie uma skill
  `verificar-etapa` em `.claude/skills/` só com isso, testando cada comando antes de escrevê-lo.
  Se não tiver, não crie: não há skill genérica.
- **.graphifyignore**: acrescente pastas de assets, builds e dados. Depois rode
  `graphify update .` (o executável está em `graphifyDir` do JSON) se mudou algo.

Se o projeto **já tinha CLAUDE.md** (aparece em `pulados`), mescle as seções do modelo
(`~/.deixacomigo/modelo/CLAUDE.md`: Idioma, Cuidados, Modelos e consultor, Revisor externo, Fluxos,
Verificação, Busca no código) ao existente sem apagar nada do usuário, trocando `__GRAPHIFY_BIN__`
pelo `graphifyDir`. Se o existente ainda tiver a regra antiga "nunca usar o Codex com modelos da
OpenAI" ou a revisão via DeepSeek, troque pela nova (o DeepSeek está fora por enquanto). Mesma regra
para skills e agentes que já existiam (aparecem em `pulados`): compare e junte, não substitua.

## 3. Chaves

A revisão externa usa o agy (login do Antigravity) e, de reserva, o subagente Sonnet, sem chave de API. O Codex não é mais usado. O
`.env.local` foi criado com `DEEPSEEK_API_KEY=` e `OPENROUTER_API_KEY=` vazios (já no `.gitignore`)
e só serve ao DeepSeek, que está fora da revisão por enquanto: não peça chaves. **Nunca leia nem
imprima esse arquivo.** Se `avisos` disser que o `agy` não existe, repasse ao usuário.

## 4. Verificar

1. `grep -rn PREENCHER CLAUDE.md tools .claude .graphifyignore` não pode achar nada.
2. `<graphifyDir>/graphify query "<algo do projeto>"` devolve nós de arquivos reais.
3. `.claude/settings.local.json` tem os hooks `PreToolUse` (4: 2 do graphify e 2 do `graphify-primeiro.py`,
   `marca` e `exige`), `Stop` (1, com `cd "$CLAUDE_PROJECT_DIR"`)
   e `SessionStart` (1), além de `model` e `advisorModel`; `.claude/settings.json` não foi criado pelo
   kit; `git status` não mostra `.env.local`, `graphify-out/` nem `settings.local.json`.
4. `bash -n .claude/hooks/revisor-sessao.sh` e `python3 -B -c "import ast;ast.parse(open('.claude/hooks/graphify-primeiro.py').read())"`
   passam e os 4 agentes de leitura de `.claude/agents/` têm
   `model: haiku` e o `revisor` tem `model: sonnet` (`grep -H '^model' .claude/agents/*.md`). `node --check tools/revisar-deepseek.mjs`,
   `node --check tools/revisar-agy.mjs`, `node --test tools/revisar-agy.test.mjs tools/montar-pacote.test.mjs` (sem modelo, não gasta cota)
   e `bash -n tools/codex-deepseek.sh` também passam.
5. Aviso de `agy` ausente: repasse ao usuário (a revisão cai para o `sonnet`). Confira também `.claude/settings.local.json`: `env.REVISOR` deve ser `agy`.

## 5. Relatório ao usuário (curto)

Diga: o que foi copiado e o que já existia; nós/arestas do grafo; o que você preencheu e onde; o que
falta com o usuário (instalar o agy e fazer login nele); o que o instalador fez com `model` e
`advisorModel` (campo `modelos`); que os hooks e o modelo só valem em novas sessões; e que o revisor
da sessão vem da variável `REVISOR` (`agy`, `sonnet` ou `nenhum`), que o instalador grava como `agy`
em `.claude/settings.local.json` (campo `modelos`), então a sessão não pergunta qual usar. **Não faça commit** a menos que o usuário peça;
se pedir, sem `Co-Authored-By`.

## Notas

- O hook `Stop` roda `graphify update .` a cada resposta (~1-2 s, só AST, sem API). Docs e imagens
  não entram no grafo.
- O hook e o CLAUDE.md guardam o caminho do graphify **desta máquina**: em outra máquina, rode o
  kit de novo.
- Atualizar o kit num projeto já instalado: `git -C ~/.deixacomigo pull` e rodar o roteiro de novo
  ("ativar o deixacomigo"). O instalador só acrescenta o que falta e atualiza o
  `settings.local.json`; arquivos já copiados (`CLAUDE.md`, skills, agentes) ficam como estão. Quando
  `avisos` disser que `CLAUDE.md` ou a skill `revisao` são de versão antiga, mescle com `modelo/`
  (passo 2): sem isso sobram regras que se contradizem com o hook e os agentes novos.
