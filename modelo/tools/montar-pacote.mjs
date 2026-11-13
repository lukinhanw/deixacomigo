#!/usr/bin/env node
// montar-pacote: monta o pacote de revisão (contexto do projeto, regras do repositório, falsos positivos já vistos,
// diff e conteúdo atual dos arquivos alterados) SEM chamar modelo nenhum. É a entrada do subagente `revisor`.
// Lê as mudanças sem mexer no índice do git (nada de `git add -N`).
//
// Uso: node tools/montar-pacote.mjs --repo back [--repo front] [--base <commit>] [--out <pasta>]
// Imprime uma linha por pacote: <caminho>\t<arquivos>\t<KB>
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coletarMudancas, lerArgumentos, montarPacotes } from './revisar-agy.mjs';

export function montarPacotesEmArquivos(argv) {
  const aqui = dirname(fileURLToPath(import.meta.url));
  const opcoes = lerArgumentos(argv);
  const raiz = resolve(opcoes.raiz ?? join(aqui, '..'));
  const outDir = resolve(opcoes.out ?? join(raiz, '.revisao-agy'));
  mkdirSync(outDir, { recursive: true });
  const gerados = [];
  for (const r of opcoes.repos) {
    const repo = resolve(raiz, r);
    const rotulo = r === '.' ? 'repo' : r.replace(/[^A-Za-z0-9_-]+/g, '_');
    const mudancas = coletarMudancas(repo, opcoes.base);
    if (mudancas.porArquivo.size === 0) continue;
    for (const pacote of montarPacotes({ repo, raiz, mudancas })) {
      const nome = [rotulo, pacote.nome].filter(Boolean).join('-');
      const caminho = join(outDir, `pacote-${nome}.md`);
      writeFileSync(caminho, pacote.texto);
      gerados.push({ caminho, arquivos: pacote.arquivos.length, kb: Math.round(Buffer.byteLength(pacote.texto) / 1024) });
    }
  }
  return gerados;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const gerados = montarPacotesEmArquivos(process.argv.slice(2));
    if (gerados.length === 0) console.error('nada para revisar');
    for (const g of gerados) console.log(`${g.caminho}\t${g.arquivos}\t${g.kb}`);
  } catch (e) {
    console.error(`erro: ${e.message}`);
    process.exit(3);
  }
}
