---
name: revisao
description: Revisão padrão do projeto — Codex (com DeepSeek ou normal) e DeepSeek exaustivo em paralelo (agy opcional), depois triagem com prova. Use ao revisar uma etapa, um conjunto de mudanças ou antes de commitar.
---

# Revisão padrão

Os dois revisores se complementam: o Codex com DeepSeek acha menos coisas, mas quase sem falsos; o
DeepSeek exaustivo acha mais, com ruído. Por isso rodam juntos.

## Quem roda (escolha pelo caso)

| Situação | Revisores |
|---|---|
| Diff comum | DeepSeek exaustivo + Codex+DeepSeek |
| Delicado (dinheiro, segurança, banco) | Os dois acima + Codex normal |
| Diff pequeno (até ~30 KB) | + agy |
| DeepSeek fora do ar | Codex normal |

## 1. Preparar

- Base: o commit anterior à etapa. Arquivo novo precisa estar no índice (`git add -N`) para aparecer no diff.
- `git diff <base> > <scratchpad>/revisao/etapa.patch`. Se passar de ~60 KB, dividir por área (ex.: servidor e cliente).
- O revisor DeepSeek lê `tools/revisao-contexto.md` (stack e arquitetura): mantenha-o atualizado.

## 2. Rodar em paralelo (Bash, sempre com `run_in_background`)

- **Codex + DeepSeek** (dentro do repositório):
  `bash tools/codex-deepseek.sh --uncommitted > <scratchpad>/revisao/codex.md 2> <scratchpad>/revisao/codex.err`
  Mudanças já commitadas: `--base <branch>` ou `--commit <SHA>`. Leva de 5 a 15 min.
- **DeepSeek exaustivo** (API oficial, centavos, ~5 min cada; tenta de novo sozinho se a resposta vier cortada):
  `node tools/revisar-deepseek.mjs --patch <scratchpad>/revisao/etapa.patch --out <scratchpad>/revisao/ds.md [--extra <arquivo de contexto>]`
- **agy** (terceira opinião, opcional e gratuita): skill `revisao-agy`.
- **Codex normal** (modelos da OpenAI, sem DeepSeek) também é permitido, no mesmo formato:
  `codex review --uncommitted > <scratchpad>/revisao/codex-oa.md 2> <scratchpad>/revisao/codex-oa.err`
  (ou `--base <branch>` / `--commit <SHA>`). Use quando quiser outra opinião ou a DeepSeek estiver fora; a assinatura pode ser
  compartilhada, então prefira a DeepSeek em revisão grande ou longa.
- Sem chave: os scripts avisam e saem com código 2; peça ao usuário para preencher o `.env.local`.

## 3. Triagem

- O Codex quase não erra: é a lista mais confiável, mas confira mesmo assim. O exaustivo traz ruído:
  cada item é uma hipótese.
- Prove com teste (script no scratchpad, teste ou o navegador) sempre que der.
- O que contradiz uma regra do README é decisão de design: relate ao usuário em vez de mudar.
- Depois das correções, rode a verificação (tipos, testes, navegador) descrita no CLAUDE.md.

## Falsos positivos já vistos neste projeto

Acrescente aqui, com uma linha cada, o que os revisores acusaram e a prova mostrou ser falso:
- (nenhum ainda)
