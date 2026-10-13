// Textos da seção "Fechamentos em aberto" (Feat Produções), compartilhados pela
// tela do relatório e pelo e-mail — os dois têm que dizer a mesma coisa.
//
// Relatório gravado antes da integração com o hubfeat (sem `fechamentosFonte`)
// mantém os textos antigos da tabela manual.

interface FechamentosMeta {
  referenciaLabel: string;
  fechamentosFonte?: "hubfeat";
  fechamentosConsultadoEm?: string;
  fechamentosDisponivel?: boolean;
}

/** False só quando o hubfeat não respondeu na geração: a seção não aparece. */
export function fechamentosVisiveis(block: FechamentosMeta): boolean {
  return block.fechamentosDisponivel !== false;
}

// Horário de Brasília explícito: o servidor (Vercel) roda em UTC.
function fmtConsulta(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const data = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const hora = d.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${data} às ${hora}`;
}

export function fechamentosSubtitulo(block: FechamentosMeta): string {
  if (block.fechamentosFonte !== "hubfeat") {
    return `Eventos realizados sem fechamento concluído até ${block.referenciaLabel}.`;
  }
  const quando = block.fechamentosConsultadoEm ? fmtConsulta(block.fechamentosConsultadoEm) : null;
  return quando
    ? `Situação atual no Hub Feat (Tabulação), consultada em ${quando}.`
    : "Situação atual no Hub Feat (Tabulação).";
}

export function fechamentosVazio(block: FechamentosMeta): string {
  return block.fechamentosFonte === "hubfeat"
    ? "Não há eventos com fechamento em aberto no Hub Feat neste momento."
    : "Não há eventos com fechamento em aberto até o período selecionado.";
}

export function fechamentosRotuloValor(block: FechamentosMeta): string {
  return block.fechamentosFonte === "hubfeat" ? "Resultado projetado" : "Resultado previsto";
}

export const FECHAMENTO_SEM_IMPOSTO = "sem imposto lançado";
