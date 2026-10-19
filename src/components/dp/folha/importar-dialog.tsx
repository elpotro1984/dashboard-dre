"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";
import { importarPlanilhaFolha, type DpImportacaoFolhaResumo } from "@/lib/dp/actions-folha";
import { rotuloCompetencia } from "@/lib/dp/folha/parametros";

/**
 * Importar a planilha de folha do DP. Dois passos: a PRÉVIA (nada gravado —
 * quem casou, quem não casou, o que vai ser substituído) e o "Importar" que
 * grava. O arquivo é reenviado no 2º passo: a action não guarda estado.
 */
export function DpImportarFolhaDialog({ companyId, competencia }: { companyId: string; competencia: string }) {
  const [aberto, setAberto] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [comMes, setComMes] = useState(true);
  const [criarAvulsos, setCriarAvulsos] = useState(true);
  const [resumo, setResumo] = useState<DpImportacaoFolhaResumo | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();

  const enviar = (confirmar: boolean) => {
    if (!file) return;
    start(async () => {
      const fd = new FormData();
      fd.set("companyId", companyId);
      fd.set("competencia", competencia);
      fd.set("comMes", comMes ? "1" : "0");
      fd.set("criarAvulsos", criarAvulsos ? "1" : "0");
      fd.set("confirmar", confirmar ? "1" : "0");
      fd.set("file", file);
      const res = await importarPlanilhaFolha(fd);
      if (!res.ok) {
        showToast({ title: "Importação não concluída", description: res.error, variant: "destructive" });
        return;
      }
      setResumo(res.data);
      if (res.data.aplicado) {
        showToast({ title: "Planilha importada", description: `${res.data.casadas} pessoa(s) atualizadas.`, variant: "success" });
        router.refresh();
      }
    });
  };

  const fechar = () => {
    if (pending) return;
    setAberto(false);
    setResumo(null);
    setFile(null);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-muted"
      >
        <Upload className="h-4 w-4" /> Importar planilha
      </button>
      <Dialog open={aberto} onOpenChange={(o) => !o && fechar()}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Importar a planilha de folha do DP</DialogTitle>
            <DialogDescription>
              Lê a aba CONTROLE (plano, odonto, alimentação, transporte, escala, adiantamento…) e grava o cadastro da folha de cada
              pessoa, casando pelo nome com a Sólides. Vale para todas as empresas que você vê.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setResumo(null);
              }}
            />
            <p className="text-xs text-ink-muted">Planilha com senha não abre aqui: tire a senha no Excel antes de enviar.</p>
            <label className="flex items-start gap-2">
              <input type="checkbox" checked={comMes} onChange={(e) => setComMes(e.target.checked)} className="mt-0.5" />
              <span>
                Trazer também o mês de <strong>{rotuloCompetencia(competencia)}</strong> (dias, férias, coparticipação, descontos) e os
                valores digitados por cima das fórmulas na aba SALÁRIO, como ajustes manuais.
              </span>
            </label>

            {resumo && (
              <div className="space-y-2 rounded-md border border-border p-3">
                <p className="font-medium text-ink-primary">
                  {resumo.aplicado ? "Importado: " : "Prévia: "}
                  {resumo.casadas} de {resumo.linhas} linha(s) casadas com a Sólides
                  {resumo.jaTinhamCadastro > 0 && ` · ${resumo.jaTinhamCadastro} já tinham cadastro e ${resumo.aplicado ? "foram" : "serão"} substituídas`}
                  {resumo.comAjustes > 0 && ` · ${resumo.comAjustes} com ajustes manuais`}
                </p>
                {(resumo.setoresDaFolha > 0 || resumo.pessoasComCentro > 0) && (
                  <p className="text-ink-muted">
                    {resumo.setoresDaFolha > 0 && `${resumo.setoresDaFolha} com setor da planilha diferente da Sólides (vira o setor da folha). `}
                    {resumo.pessoasComCentro > 0 &&
                      `${resumo.pessoasComCentro} recebem o centro de custo da planilha${resumo.centrosNovos ? ` (${resumo.centrosNovos} centro(s) novos no cadastro do DP)` : ""}; quem já tinha centro definido fica como está.`}
                  </p>
                )}
                {resumo.porEmpresa.length > 0 && (
                  <p className="text-ink-muted">{resumo.porEmpresa.map((e) => `${e.empresa}: ${e.pessoas}`).join(" · ")}</p>
                )}
                {resumo.foraDoEscopo > 0 && <p className="text-ink-muted">{resumo.foraDoEscopo} de empresas que você não vê (não importadas).</p>}
                {resumo.semEmpresa > 0 && (
                  <p className="text-amber-700 dark:text-amber-400">
                    {resumo.semEmpresa} sem empresa no de-para da Sólides: o cadastro {resumo.aplicado ? "entrou" : "entra"}, e elas aparecem na folha quando o
                    de-para for feito (Configurações › Empresas).
                  </p>
                )}
                {resumo.mesesFechados > 0 && <p className="text-amber-700 dark:text-amber-400">{resumo.mesesFechados} com a folha do mês fechada — só o cadastro entra.</p>}
                {resumo.parciais.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-ink-muted">{resumo.parciais.length} casada(s) por nome parecido — confira</summary>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {resumo.parciais.map((p) => (
                        <li key={p.planilha}>
                          {p.planilha} → <strong>{p.solides}</strong>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {resumo.naoEncontradas.length > 0 && (
                  <details open>
                    <summary className="cursor-pointer text-amber-700 dark:text-amber-400">{resumo.naoEncontradas.length} não encontrada(s) na Sólides</summary>
                    <p className="mt-1 text-xs">{resumo.naoEncontradas.join(" · ")}</p>
                  </details>
                )}
                {resumo.avulsosNovos > 0 && (
                  <label className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      disabled={resumo.aplicado}
                      checked={criarAvulsos}
                      onChange={(e) => setCriarAvulsos(e.target.checked)}
                    />
                    <span>
                      {resumo.aplicado ? "Incluídas" : "Incluir"} as <strong>{resumo.avulsosNovos}</strong> não encontradas como pessoas
                      &quot;fora da Sólides&quot;, com nome, empresa, setor, contrato, salário e nascimento da planilha. Quando aparecerem
                      na Sólides, a folha avisa para unificar.
                    </span>
                  </label>
                )}
                {resumo.avulsosSemEmpresa.length > 0 && (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Sem empresa deduzível (não incluídas): {resumo.avulsosSemEmpresa.join(" · ")}
                  </p>
                )}
                {resumo.ambiguas.length > 0 && (
                  <details open>
                    <summary className="cursor-pointer text-amber-700 dark:text-amber-400">{resumo.ambiguas.length} com mais de um candidato (não importadas)</summary>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {resumo.ambiguas.map((a) => (
                        <li key={a.planilha}>
                          {a.planilha}: {a.candidatos.join(", ")}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {resumo.avisos.length > 0 && (
                  <details>
                    <summary className="cursor-pointer text-ink-muted">{resumo.avisos.length} aviso(s) de leitura</summary>
                    <ul className="mt-1 space-y-0.5 text-xs">
                      {resumo.avisos.map((a) => (
                        <li key={a.texto}>
                          {a.texto} ({a.vezes}×)
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <button type="button" className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted" onClick={fechar} disabled={pending}>
              {resumo?.aplicado ? "Fechar" : "Cancelar"}
            </button>
            {!resumo?.aplicado && (
              <button
                type="button"
                disabled={!file || pending}
                onClick={() => enviar(Boolean(resumo))}
                className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {pending ? "Lendo…" : resumo ? `Importar ${resumo.casadas} pessoa(s)` : "Ver prévia"}
              </button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
