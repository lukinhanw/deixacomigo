---
name: verificar-etapa
description: Verificação completa do projeto antes de dar uma etapa ou correção por pronta — tipos, testes, serviços, integração e teste no navegador com print + análise. Use ao terminar uma feature, uma rodada de correções ou antes de commitar.
---

# Verificar etapa

Pare na primeira falha, corrija e recomece daquela fase. Apague as fases que não se aplicam ao projeto.

1. **Tipos / lint**: <!-- PREENCHER: comando real (ex.: npm run typecheck) -->
2. **Testes**: <!-- PREENCHER: comando real (ex.: npm test). Lógica nova ganha teste junto. -->
3. **Serviços**: <!-- PREENCHER: como subir banco, servidor e cliente; portas; o que não mexer -->
4. **Integração**: <!-- PREENCHER: script no scratchpad exercitando o que mudou, ou apague a fase -->
5. **Navegador** (só se houver interface; Playwright MCP): subir o app, abrir, interagir, **tirar print**,
   **abrir o print e analisar** (o que está certo, o que está errado, o que mudou) e conferir o console
   (erros e avisos). Prints ficam no scratchpad, não no repositório.
   <!-- PREENCHER: seletores, URL e particularidades da interface, ou apague a fase -->
6. **Relatório**: o que passou, prints com análise, e o que ficou de fora e por quê.
