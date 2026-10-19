"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";
import { salvarAvulso } from "@/lib/dp/actions-folha";
import { CONTRATOS_AVULSO, type DpAvulsoEntrada } from "@/lib/dp/folha/avulsos";

import { inputCls, NumCampo } from "./campos";

export const AVULSO_VAZIO: DpAvulsoEntrada = {
  nome: "",
  cpf: null,
  setor: null,
  tipoContrato: "CLT",
  salario: null,
  nascimento: null,
  admissao: null,
  desligamento: null,
  observacao: null,
};

function Campo({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-0.5">
      <span className="text-xs font-medium text-ink-muted">{rotulo}</span>
      {children}
    </label>
  );
}

/** Os dados que a Sólides daria, digitados no próprio DP (pessoa fora da Sólides). */
export function DpAvulsoCampos({ v, onChange, disabled }: { v: DpAvulsoEntrada; onChange: (v: DpAvulsoEntrada) => void; disabled?: boolean }) {
  const set = <K extends keyof DpAvulsoEntrada>(k: K, x: DpAvulsoEntrada[K]) => onChange({ ...v, [k]: x });
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <div className="col-span-2">
        <Campo rotulo="Nome">
          <input className={inputCls} disabled={disabled} value={v.nome} onChange={(e) => set("nome", e.target.value)} maxLength={200} />
        </Campo>
      </div>
      <Campo rotulo="CPF (opcional)">
        <input className={inputCls} disabled={disabled} value={v.cpf ?? ""} onChange={(e) => set("cpf", e.target.value || null)} inputMode="numeric" />
      </Campo>
      <Campo rotulo="Setor">
        <input className={inputCls} disabled={disabled} value={v.setor ?? ""} onChange={(e) => set("setor", e.target.value || null)} maxLength={120} />
      </Campo>
      <Campo rotulo="Contrato">
        <select className={inputCls} disabled={disabled} value={v.tipoContrato ?? "CLT"} onChange={(e) => set("tipoContrato", e.target.value)}>
          {CONTRATOS_AVULSO.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Campo>
      <Campo rotulo="Salário / valor mensal">
        <NumCampo valor={v.salario ?? 0} onChange={(x) => set("salario", x > 0 ? x : null)} disabled={disabled} />
      </Campo>
      <Campo rotulo="Nascimento">
        <input type="date" className={inputCls} disabled={disabled} value={v.nascimento ?? ""} onChange={(e) => set("nascimento", e.target.value || null)} />
      </Campo>
      <Campo rotulo="Admissão">
        <input type="date" className={inputCls} disabled={disabled} value={v.admissao ?? ""} onChange={(e) => set("admissao", e.target.value || null)} />
      </Campo>
      <Campo rotulo="Desligamento">
        <input type="date" className={inputCls} disabled={disabled} value={v.desligamento ?? ""} onChange={(e) => set("desligamento", e.target.value || null)} />
      </Campo>
    </div>
  );
}

/** Botão + janela para incluir na folha alguém que não existe na Sólides. */
export function DpIncluirAvulso({ companyId, companyName }: { companyId: string; companyName: string }) {
  const [aberto, setAberto] = useState(false);
  const [v, setV] = useState<DpAvulsoEntrada>(AVULSO_VAZIO);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();

  const salvar = () =>
    start(async () => {
      const res = await salvarAvulso({ companyId, dados: v });
      if (!res.ok) {
        showToast({ title: "Não incluído", description: res.error, variant: "destructive" });
        return;
      }
      showToast({ title: "Pessoa incluída na folha", description: `${v.nome} — complete plano, VA e VT na janela dela.`, variant: "success" });
      setAberto(false);
      setV(AVULSO_VAZIO);
      router.refresh();
    });

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm font-medium hover:bg-muted"
      >
        <UserPlus className="h-4 w-4" /> Pessoa fora da Sólides
      </button>
      <Dialog open={aberto} onOpenChange={(o) => !o && !pending && setAberto(false)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Incluir na folha de {companyName}</DialogTitle>
            <DialogDescription>
              Para quem está na folha e não existe na Sólides (PJ, cadastro atrasado). A pessoa entra marcada como &quot;fora da
              Sólides&quot;; quando aparecer lá, a folha avisa para unificar.
            </DialogDescription>
          </DialogHeader>
          <DpAvulsoCampos v={v} onChange={setV} disabled={pending} />
          <DialogFooter>
            <button type="button" className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-muted" disabled={pending} onClick={() => setAberto(false)}>
              Cancelar
            </button>
            <button
              type="button"
              disabled={pending || !v.nome.trim()}
              onClick={salvar}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {pending ? "Incluindo…" : "Incluir"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
