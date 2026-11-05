# INSTALAR.md — roteiro para o agente

Você é o agente que recebeu o pedido "ativar o deixacomigo" num projeto. Este arquivo é o roteiro
completo. Siga na ordem, sem pedir confirmação a cada passo (só onde indicado). Responda em
português do Brasil.

O kit instala no projeto atual: regras (`CLAUDE.md`), busca por grafo (graphify com hooks),
revisão externa (Codex+DeepSeek, DeepSeek exaustivo, agy) e a skill `verificar-etapa`.

## 0. Onde está o kit

O kit vive em `~/.deixacomigo`. Se não existir: `git clone https://github.com/lukinhanw/deixacomigo ~/.deixacomigo`.
Se existir: `git -C ~/.deixacomigo pull --ff-only`. (Windows: `~` = pasta do usuário.)

## 1. Rodar a parte automática

Na raiz do projeto (precisa ser um repositório git; se não for, `git init`):

```bash
node ~/.deixacomigo/instalar.mjs .
```

Ele instala o graphify, copia os arquivos de `modelo/` **sem sobrescrever nada**, ajusta o
`.gitignore`, gera o grafo e grava os hooks em `.claude/settings.local.json`. No fim imprime um JSON:
`copiados`, `pulados`, `avisos`, `erros`, `placeholders`, `grafo`, `graphifyDir`.
Se `erros` não estiver vazio, corrija a causa (ele diz qual) e rode de novo: é idempotente.

## 2. Preencher o que é específico do projeto

Leia README, manifesto (`package.json`, `pyproject.toml`, …) e a estrutura de pastas. Depois
procure `PREENCHER` (a lista está em `placeholders`) e substitua cada marcador por conteúdo real,
apagando o comentário:

- **CLAUDE.md**: 1 a 2 linhas do que é o projeto; gotchas que **não dá para ver lendo o código**
  (portas, serviços, comandos não óbvios, armadilhas). Não copie estrutura de pastas, lista de
  dependências nem comandos padrão: a sessão deduz sozinha.
- **tools/revisao-contexto.md**: 2 a 5 linhas para o revisor (o que é, stack com versões,
  arquitetura). Os revisores externos não veem o repositório inteiro, só isso e o diff.
- **.claude/skills/verificar-etapa/SKILL.md**: comandos reais de tipos, testes, serviços e, se
  houver interface, URL e seletores. Apague as fases que não existem. Teste que cada comando
  funciona antes de escrevê-lo.
- **.graphifyignore**: acrescente pastas de assets, builds e dados. Depois rode
  `graphify update .` (o executável está em `graphifyDir` do JSON) se mudou algo.

Se o projeto **já tinha CLAUDE.md** (aparece em `pulados`), mescle as seções do modelo
(`~/.deixacomigo/modelo/CLAUDE.md`: Idioma, Cuidados, Fluxos, Busca no código) ao existente sem
apagar nada do usuário, trocando `__GRAPHIFY_BIN__` pelo `graphifyDir`. Mesma regra para skills
que já existiam: compare e junte, não substitua.

## 3. Chaves

O `.env.local` foi criado com `DEEPSEEK_API_KEY=` e `OPENROUTER_API_KEY=` vazios (já no
`.gitignore`). **Nunca leia nem imprima esse arquivo.** Diga ao usuário para colocar as chaves nele
(só a DeepSeek é obrigatória; OpenRouter é opcional). Sem chave, a revisão externa avisa e para.

## 4. Verificar

1. `grep -rn PREENCHER CLAUDE.md tools .claude .graphifyignore` não pode achar nada.
2. `<graphifyDir>/graphify query "<algo do projeto>"` devolve nós de arquivos reais.
3. `.claude/settings.local.json` tem os hooks `PreToolUse` (2) e `Stop` (1); `.claude/settings.json`
   não foi criado pelo kit; `git status` não mostra `.env.local`, `graphify-out/` nem `settings.local.json`.
4. `node --check tools/revisar-deepseek.mjs` e `bash -n tools/codex-deepseek.sh` passam.
5. Avisos de `codex`/`agy` ausentes: repasse ao usuário (a revisão correspondente fica de fora).

## 5. Relatório ao usuário (curto)

Diga: o que foi copiado e o que já existia; nós/arestas do grafo; o que você preencheu e onde; o que
falta com o usuário (chaves, instalar codex/agy); e que os hooks só valem em novas sessões. **Não
faça commit** a menos que o usuário peça; se pedir, sem `Co-Authored-By`.

## Notas

- O hook `Stop` roda `graphify update .` a cada resposta (~1-2 s, só AST, sem API). Docs e imagens
  não entram no grafo.
- O hook e o CLAUDE.md guardam o caminho do graphify **desta máquina**: em outra máquina, rode o
  kit de novo.
- Atualizar o kit num projeto já instalado: `git -C ~/.deixacomigo pull` e rodar o instalador de
  novo (ele só acrescenta o que falta; para receber mudanças de arquivos já copiados, compare
  `modelo/` com o projeto à mão).
