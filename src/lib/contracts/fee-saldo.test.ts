import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decidirPorSaldoFee, montarSaldoFee } from './fee-saldo'

// Linha da carteira_realizado: A=franquia, C=fundo, L=saldo projetado,
// O=FEE restante, U=situação.
function linha(fundo: string, saldoProjetado: unknown, feeRestante: unknown, situacao = 'Comum') {
  const row: unknown[] = new Array(21).fill('')
  row[0] = 'Porto Velho'
  row[2] = fundo
  row[11] = saldoProjetado
  row[14] = feeRestante
  row[20] = situacao
  return row as (string | number)[]
}

test('limite é o menor entre FEE restante e saldo projetado', () => {
  const m = montarSaldoFee([linha('FUNDO.A', 2264.85, 8400.12), linha('FUNDO.B', 37270.36, 29556)])
  assert.equal(m.byKey.get('fundoa')?.saldo, 2264.85)
  assert.equal(m.byKey.get('fundob')?.saldo, 29556)
})

test('caso da RP 872197: FEE restante cobre, caixa não → reprova pelo caixa', () => {
  const m = montarSaldoFee([linha('FUNDO.A', 2264.85, 8400.12)])
  const d = decidirPorSaldoFee('fundo-a', 5000, m, null)
  assert.equal(d.status, 'reprovada')
  assert.match(d.resumo, /saldo projetado/)
})

test('dentro do limite aprova, com tolerância de centavos', () => {
  const m = montarSaldoFee([linha('FUNDO.B', 37270.36, 29556)])
  assert.equal(decidirPorSaldoFee('FUNDO.B', 29556.01, m, null).status, 'aprovada')
  assert.equal(decidirPorSaldoFee('FUNDO.B', 29557, m, null).status, 'reprovada')
})

test('saldo projetado negativo reprova', () => {
  const m = montarSaldoFee([linha('FUNDO.C', -100, 5000)])
  assert.equal(decidirPorSaldoFee('FUNDO.C', 10, m, null).status, 'reprovada')
})

test('fundo em rescisão vai para especialista mesmo com saldo', () => {
  const m = montarSaldoFee([linha('FUNDO.D', 9000, 9000, 'Rescindindo'), linha('FUNDO.E', 9000, 9000, 'Rescindido')])
  assert.equal(decidirPorSaldoFee('FUNDO.D', 10, m, null).status, 'analise_especialista')
  assert.equal(decidirPorSaldoFee('FUNDO.E', 10, m, null).status, 'analise_especialista')
})

test('célula vazia em O ou L não decide (vazio ≠ zero)', () => {
  const m = montarSaldoFee([linha('FUNDO.F', '', 5000), linha('FUNDO.G', 5000, '')])
  for (const f of ['FUNDO.F', 'FUNDO.G']) {
    const d = decidirPorSaldoFee(f, 10, m, null)
    assert.equal(d.status, 'analise_especialista')
    assert.match(d.resumo, /sem valor/)
  }
})

test('duplicado divergente, fundo ausente e planilha inacessível vão para especialista', () => {
  const m = montarSaldoFee([linha('FUNDO.H', 100, 100), linha('FUNDO-H', 500, 500)])
  assert.equal(decidirPorSaldoFee('FUNDO.H', 10, m, null).status, 'analise_especialista')
  assert.equal(decidirPorSaldoFee('NAO.EXISTE', 10, m, null).status, 'analise_especialista')
  assert.equal(decidirPorSaldoFee('FUNDO.H', 10, null, 'Sheets API 403').status, 'analise_especialista')
})
