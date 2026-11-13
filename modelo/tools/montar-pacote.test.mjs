// Testes do montar-pacote.mjs. Rodar: node --test tools/montar-pacote.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { montarPacotesEmArquivos } from './montar-pacote.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'montar-pacote-'));
const git = (dir, ...args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });

test('grava o pacote com diff, arquivo novo e falsos positivos, sem tocar o índice', () => {
  const repo = tmp();
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@example.invalid');
  git(repo, 'config', 'user.name', 'T');
  writeFileSync(join(repo, 'a.php'), '<?php\n$a = 1;\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  writeFileSync(join(repo, 'a.php'), '<?php\n$a = 2;\n');
  writeFileSync(join(repo, 'novo.php'), '<?php\necho 1;\n');
  const antes = git(repo, 'status', '--porcelain').stdout;

  const raiz = tmp();
  mkdirSync(join(raiz, '.claude', 'skills', 'revisao'), { recursive: true });
  writeFileSync(join(raiz, '.claude', 'skills', 'revisao', 'SKILL.md'), '## Falsos positivos\n- agy: "falso conhecido". Falso.\n');
  const out = join(raiz, 'saida');

  const [g, ...resto] = montarPacotesEmArquivos(['--repo', repo, '--raiz', raiz, '--out', out]);
  assert.equal(resto.length, 0);
  assert.equal(g.arquivos, 2);
  const texto = readFileSync(g.caminho, 'utf8');
  for (const trecho of ['+$a = 2;', '## novo.php', 'falso conhecido']) assert.ok(texto.includes(trecho), trecho);
  assert.equal(git(repo, 'status', '--porcelain').stdout, antes);
});

test('sem mudanças não gera pacote', () => {
  const repo = tmp();
  git(repo, 'init', '-q');
  git(repo, 'config', 'user.email', 't@example.invalid');
  git(repo, 'config', 'user.name', 'T');
  writeFileSync(join(repo, 'a.php'), '<?php\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  assert.deepEqual(montarPacotesEmArquivos(['--repo', repo, '--raiz', tmp(), '--out', join(tmp(), 's')]), []);
});
