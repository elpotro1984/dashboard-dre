// Saldo FEE por fundo — planilha "BACKEND FLUXO PROJETADO FRANQUIAS", aba
// "carteira_realizado" (decisão 2026-10-21). Coluna C = nome do fundo,
// O = "VALOR RESTANTE DE FEE", L = "SALDO PROJETADO" (créditos − débitos).
// Regra (decisão 2026-08-13): RP de FEE/Cerimonial é aprovada se o valor
// couber no saldo do fundo e reprovada se estourar; qualquer situação em que
// o saldo não possa ser determinado cai em análise especialista — o fallback
// nunca aprova nem reprova às cegas.
//
// Até 21/10/2026 a fonte era a aba "CONTROLE FEE QUOKKA (IMPORT)" (coluna K,
// saque disponível SPDX), com trava de 30 dias sobre a data da coluna L. Essa
// data parou em 07/04/2026 e mandou 100% das RPs de FEE para especialista. A
// carteira_realizado não tem coluna de data — é calculada ao vivo na planilha —,
// então a trava de frescor saiu junto com a aba.

import { fetchSheetTabTitleByGid, fetchSheetValues, type SheetRow } from '@/lib/sheets/client'

const FEE_SALDO_SPREADSHEET_ID = '1ymgmW6ISadb8xKBpcNDXTnGr0buoOFVszSZmxaOxKBQ'
// Aba resolvida pelo gid (estável a renomeação).
const CARTEIRA_GID = 429827027

// Índices 0-based: A=Franquia, C=Fundo, L=Saldo projetado, O=Valor restante
// de FEE, U=Situação.
const COL_UNIDADE = 0
const COL_NOME = 2
const COL_SALDO_PROJETADO = 11
const COL_FEE_RESTANTE = 14
const COL_SITUACAO = 20

// O limite é o MENOR entre o FEE restante e o caixa do fundo (decisão
// 2026-10-21). Só o FEE restante ignora o caixa: na leitura daquele dia, 625
// dos 1.187 fundos com FEE a receber tinham FEE restante acima do saldo
// projetado — foi o mesmo erro que aprovou a RP 872197 em 14/08 (FEE restante
// 8.400,12 com saque real de 2.264,85).
//
// Fundo em rescisão não aprova pagamento automaticamente — mesmo enquadramento
// da antiga aba "FUNDOS INATIVOS", que ficava de fora da leitura.
const SITUACOES_ESPECIALISTA = new Set(['rescindindo', 'rescindido'])

// Mesma tolerância de centavos usada na validação de valores (validate.ts).
const SALDO_TOLERANCE = 0.02

export interface FeeSaldoEntry {
  /** Nome do fundo como está na planilha (para exibição/auditoria). */
  nome: string
  unidade: string
  situacao: string
  /** Coluna O. */
  feeRestante: number
  /** Coluna L. */
  saldoProjetado: number
  /** O limite que decide: menor entre `feeRestante` e `saldoProjetado`. */
  saldo: number
}

export interface FeeSaldoMap {
  byKey: Map<string, FeeSaldoEntry>
  /** Chaves que aparecem em mais de uma linha com saldos divergentes. */
  conflitos: Set<string>
  /** Fundos presentes na aba mas com a coluna O ou L vazia/não numérica. */
  semSaldo: Set<string>
  totalLinhas: number
}

// Os nomes de fundo não têm grafia estável entre a base de RPs e a planilha
// ("ISABELI.CAMPIDELI PUC-PSICO 2029-2" vs "ISABELI-CAMPIDELI-PUC-PSICO-2029-2"),
// então a chave descarta tudo que não é letra ou número.
export function normFundo(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function parseNumero(cell: unknown): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null
  if (typeof cell === 'string' && cell.trim() !== '') {
    const n = Number(cell.replace(/\./g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Monta o mapa fundo → limite a partir das linhas da aba (sem cabeçalho). Pura. */
export function montarSaldoFee(rows: SheetRow[]): FeeSaldoMap {
  const byKey = new Map<string, FeeSaldoEntry>()
  const conflitos = new Set<string>()
  const semSaldo = new Set<string>()
  for (const row of rows) {
    const nome = String(row[COL_NOME] ?? '').trim()
    const key = normFundo(nome)
    if (!key) continue
    const feeRestante = parseNumero(row[COL_FEE_RESTANTE])
    const saldoProjetado = parseNumero(row[COL_SALDO_PROJETADO])
    if (feeRestante === null || saldoProjetado === null) {
      if (!byKey.has(key)) semSaldo.add(key)
      continue
    }
    const saldo = Math.min(feeRestante, saldoProjetado)
    const existente = byKey.get(key)
    if (existente && Math.abs(existente.saldo - saldo) > SALDO_TOLERANCE) {
      // Linhas duplicadas com saldos diferentes: não dá para saber qual vale.
      conflitos.add(key)
      continue
    }
    byKey.set(key, {
      nome,
      unidade: String(row[COL_UNIDADE] ?? '').trim(),
      situacao: String(row[COL_SITUACAO] ?? '').trim(),
      feeRestante,
      saldoProjetado,
      saldo,
    })
    semSaldo.delete(key)
  }
  return { byKey, conflitos, semSaldo, totalLinhas: rows.length }
}

/** Lê a aba carteira_realizado e monta o mapa fundo → limite. */
export async function loadFeeSaldo(): Promise<FeeSaldoMap> {
  const tab = await fetchSheetTabTitleByGid(FEE_SALDO_SPREADSHEET_ID, CARTEIRA_GID)
  const rows = await fetchSheetValues(FEE_SALDO_SPREADSHEET_ID, `'${tab.replace(/'/g, "''")}'!A2:U`)
  return montarSaldoFee(rows)
}

export interface FeeDecisao {
  status: 'aprovada' | 'reprovada' | 'analise_especialista'
  resumo: string
  motivos: string[]
}

const fmt = (n: number) => `R$ ${n.toFixed(2)}`

/**
 * Decide uma RP de FEE/Cerimonial pelo saldo do fundo. Pura (sem I/O) para
 * ser testável; `saldoMap` nulo indica que a planilha não pôde ser lida.
 */
export function decidirPorSaldoFee(
  fundo: string | null | undefined,
  valorRp: number | string | null | undefined,
  saldoMap: FeeSaldoMap | null,
  loadError: string | null,
): FeeDecisao {
  const especialista = (motivo: string): FeeDecisao => ({
    status: 'analise_especialista',
    resumo: `FEE/Cerimonial — análise especialista (${motivo})`,
    motivos: [motivo],
  })

  if (!saldoMap) {
    return especialista(
      `planilha de saldo FEE inacessível${loadError ? `: ${loadError.slice(0, 200)}` : ''}`,
    )
  }

  const valor = valorRp === null || valorRp === undefined ? NaN : Number(valorRp)
  if (!Number.isFinite(valor)) {
    return especialista('valor da RP ausente ou ilegível — não foi possível comparar com o saldo FEE')
  }

  const key = normFundo(fundo)
  if (!key) {
    return especialista('RP sem fundo informado — não foi possível localizar o saldo FEE')
  }
  if (saldoMap.conflitos.has(key)) {
    return especialista(
      `fundo "${String(fundo).trim()}" aparece mais de uma vez na carteira_realizado com saldos divergentes`,
    )
  }
  const entry = saldoMap.byKey.get(key)
  if (!entry) {
    if (saldoMap.semSaldo.has(key)) {
      return especialista(
        `fundo "${String(fundo).trim()}" está na carteira_realizado, mas sem valor no FEE restante (coluna O) ou no saldo projetado (coluna L)`,
      )
    }
    return especialista(
      `fundo "${String(fundo).trim()}" não encontrado na aba carteira_realizado`,
    )
  }
  if (SITUACOES_ESPECIALISTA.has(normFundo(entry.situacao))) {
    return especialista(
      `fundo "${entry.nome}" em situação "${entry.situacao}" na carteira_realizado — pagamento de fundo em rescisão não é decidido automaticamente`,
    )
  }

  const detalhe = `fundo "${entry.nome}" (${entry.unidade || 'sem unidade'}): FEE restante ${fmt(entry.feeRestante)}, saldo projetado ${fmt(entry.saldoProjetado)}, limite ${fmt(entry.saldo)}, RP ${fmt(valor)}`
  if (valor <= entry.saldo + SALDO_TOLERANCE) {
    return {
      status: 'aprovada',
      resumo: `Aprovada — FEE/Cerimonial dentro do limite do fundo (${fmt(entry.saldo)} disponível, RP ${fmt(valor)})`,
      motivos: [`O limite do fundo (menor entre FEE restante e saldo projetado) comporta a requisição: ${detalhe}`],
    }
  }
  const limitante = entry.saldoProjetado < entry.feeRestante ? 'saldo projetado do fundo' : 'FEE restante'
  return {
    status: 'reprovada',
    resumo: `Reprovada — FEE/Cerimonial acima do limite do fundo (${fmt(entry.saldo)} disponível pelo ${limitante}, RP ${fmt(valor)})`,
    motivos: [`Valor da RP excede o limite do fundo (menor entre FEE restante e saldo projetado): ${detalhe}`],
  }
}
