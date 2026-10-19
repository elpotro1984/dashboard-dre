"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Search, Trash2, UserPlus } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";
import type { DpRole } from "@/lib/auth/dp";
import { DESCRICAO_PAPEL, ROTULO_PAPEL } from "@/lib/dp/acessos";
import type { DpConcessaoRow, DpUsuarioRef } from "@/lib/dp/acessos-queries";
import { removerAcessoDp, salvarAcessoDp } from "@/lib/dp/actions-acessos";

interface Empresa {
  id: string;
  name: string;
  ativos: number;
}

const botaoCls =
  "inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm font-medium text-ink-primary hover:bg-muted disabled:opacity-50";
const primarioCls =
  "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50";

type Edicao = { modo: "novo" } | { modo: "editar"; row: DpConcessaoRow };

/**
 * Concessões do DP. A tela não decide regra nenhuma (bloqueio nominal, último
 * gestor, auto-rebaixamento): manda para a action e mostra a recusa dela —
 * repetir a regra aqui faria a tela oferecer o que o servidor recusa.
 */
export function DpAcessosClient({
  concessoes,
  usuarios,
  empresas,
  meuId,
}: {
  concessoes: DpConcessaoRow[];
  usuarios: DpUsuarioRef[];
  empresas: Empresa[];
  meuId: string;
}) {
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [remover, setRemover] = useState<DpConcessaoRow | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();
  const nomeEmpresa = useMemo(() => new Map(empresas.map((e) => [e.id, e.name])), [empresas]);

  const confirmarRemocao = () => {
    if (!remover) return;
    start(async () => {
      const res = await removerAcessoDp({ userId: remover.userId });
      if (!res.ok) showToast({ title: "Não removido", description: res.error, variant: "destructive" });
      else {
        showToast({ title: "Acesso removido", description: remover.nome ?? remover.email, variant: "success" });
        setRemover(null);
      }
      router.refresh();
    });
  };

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-muted">
            {concessoes.filter((c) => c.papel).length} pessoa(s) com o Departamento Pessoal.
          </p>
          <button type="button" className={primarioCls} onClick={() => setEdicao({ modo: "novo" })} disabled={usuarios.length === 0}>
            <UserPlus className="h-4 w-4" /> Conceder acesso
          </button>
        </div>

        <table className="w-full text-sm">
          <thead className="text-left text-ink-muted">
            <tr className="border-b border-border">
              <th className="py-2 pr-2 font-medium">Pessoa</th>
              <th className="w-28 py-2 pr-2 font-medium">Papel</th>
              <th className="py-2 pr-2 font-medium">Empresas</th>
              <th className="w-20 py-2" />
            </tr>
          </thead>
          <tbody>
            {concessoes.map((c) => (
              <tr key={c.userId} className="border-b border-border align-top last:border-0">
                <td className="py-2 pr-2">
                  <div className="font-medium text-ink-primary">
                    {c.nome ?? c.email}
                    {c.userId === meuId && <span className="ml-1.5 text-xs font-normal text-ink-muted">(você)</span>}
                  </div>
                  <div className="text-xs text-ink-muted">{c.email}</div>
                  {!c.ativo && <div className="text-xs text-amber-700 dark:text-amber-400">Usuário inativo — sem acesso enquanto estiver assim.</div>}
                </td>
                <td className="py-2 pr-2">
                  {c.papel ? (
                    ROTULO_PAPEL[c.papel]
                  ) : (
                    <span className="text-red-700 dark:text-red-400" title="A sessão ignora esta linha (e-mail bloqueado ou papel desconhecido).">
                      Sem efeito
                    </span>
                  )}
                </td>
                <td className="py-2 pr-2">
                  {c.papel === "gestor" ? (
                    <span className="text-ink-muted">Todas</span>
                  ) : c.papel === "analista" ? (
                    c.empresas.length === 0 ? (
                      <span className="text-amber-700 dark:text-amber-400">Nenhuma — não vê nada</span>
                    ) : (
                      <span className="text-ink-primary">{c.empresas.map((id) => nomeEmpresa.get(id) ?? "Empresa inativa").join(" · ")}</span>
                    )
                  ) : (
                    <span className="text-ink-muted">—</span>
                  )}
                </td>
                <td className="py-2 text-right">
                  <div className="inline-flex gap-1">
                    {c.papel && (
                      <button
                        type="button"
                        className="rounded p-1 text-ink-muted hover:bg-muted hover:text-ink-primary"
                        onClick={() => setEdicao({ modo: "editar", row: c })}
                        aria-label={`Editar acesso de ${c.nome ?? c.email}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    {c.userId !== meuId && (
                      <button
                        type="button"
                        className="rounded p-1 text-ink-muted hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40"
                        onClick={() => setRemover(c)}
                        aria-label={`Remover acesso de ${c.nome ?? c.email}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>

      {edicao && (
        <EdicaoDialog
          key={edicao.modo === "editar" ? edicao.row.userId : "novo"}
          edicao={edicao}
          usuarios={usuarios}
          empresas={empresas}
          meuId={meuId}
          onClose={() => setEdicao(null)}
        />
      )}

      <Dialog open={remover !== null} onOpenChange={(o) => !o && !pending && setRemover(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover o acesso ao DP?</DialogTitle>
            <DialogDescription>
              <strong>{remover?.nome ?? remover?.email}</strong> deixa de ver o Departamento Pessoal na hora — o módulo some do
              menu. Dá para conceder de novo depois.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button type="button" className={botaoCls} disabled={pending} onClick={() => setRemover(null)}>
              Cancelar
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={confirmarRemocao}
              className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" /> {pending ? "Removendo…" : "Remover acesso"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function EdicaoDialog({
  edicao,
  usuarios,
  empresas,
  meuId,
  onClose,
}: {
  edicao: Edicao;
  usuarios: DpUsuarioRef[];
  empresas: Empresa[];
  meuId: string;
  onClose: () => void;
}) {
  const atual = edicao.modo === "editar" ? edicao.row : null;
  const [userId, setUserId] = useState<string>(atual?.userId ?? "");
  const [papel, setPapel] = useState<DpRole>(atual?.papel ?? "analista");
  const [marcadas, setMarcadas] = useState<Set<string>>(() => new Set(atual?.empresas ?? []));
  const [buscaUser, setBuscaUser] = useState("");
  const [buscaEmp, setBuscaEmp] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const { showToast } = useToast();

  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const usuariosVisiveis = useMemo(() => {
    const q = norm(buscaUser.trim());
    return q ? usuarios.filter((u) => norm(`${u.nome ?? ""} ${u.email}`).includes(q)) : usuarios;
  }, [usuarios, buscaUser]);
  const empresasVisiveis = useMemo(() => {
    const q = norm(buscaEmp.trim());
    return q ? empresas.filter((e) => norm(e.name).includes(q)) : empresas;
  }, [empresas, buscaEmp]);

  const alterna = (id: string) =>
    setMarcadas((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const salvar = () =>
    start(async () => {
      const res = await salvarAcessoDp({ userId, papel, empresas: papel === "analista" ? Array.from(marcadas) : [] });
      if (!res.ok) {
        showToast({ title: "Não salvo", description: res.error, variant: "destructive" });
        return;
      }
      showToast({ title: atual ? "Acesso atualizado" : "Acesso concedido", variant: "success" });
      onClose();
      router.refresh();
    });

  const eu = atual?.userId === meuId;

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{atual ? `Acesso de ${atual.nome ?? atual.email}` : "Conceder o Departamento Pessoal"}</DialogTitle>
          <DialogDescription>
            O módulo é sigiloso: quem recebe passa a ver nome, salário e dados pessoais das empresas liberadas.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {!atual && (
            <div className="space-y-1.5">
              <span className="font-medium text-ink-primary">Pessoa</span>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-ink-muted" />
                <input
                  value={buscaUser}
                  onChange={(e) => setBuscaUser(e.target.value)}
                  placeholder="Buscar por nome ou e-mail"
                  className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-2"
                />
              </div>
              <div className="max-h-44 overflow-y-auto rounded-md border border-border">
                {usuariosVisiveis.length === 0 ? (
                  <p className="px-3 py-2 text-ink-muted">Ninguém encontrado.</p>
                ) : (
                  usuariosVisiveis.map((u) => (
                    <label key={u.id} className="flex cursor-pointer items-baseline gap-2 px-3 py-1.5 hover:bg-muted">
                      <input type="radio" name="dp-user" checked={userId === u.id} onChange={() => setUserId(u.id)} />
                      <span className="text-ink-primary">{u.nome ?? u.email}</span>
                      <span className="truncate text-xs text-ink-muted">{u.email}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <span className="font-medium text-ink-primary">Papel</span>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["analista", "gestor"] as const).map((p) => (
                <label
                  key={p}
                  className={`flex cursor-pointer flex-col gap-0.5 rounded-md border px-3 py-2 ${papel === p ? "border-primary bg-primary/5" : "border-border hover:bg-muted"} ${eu && p !== "gestor" ? "cursor-not-allowed opacity-50" : ""}`}
                >
                  <span className="flex items-center gap-2 font-medium text-ink-primary">
                    <input type="radio" name="dp-papel" checked={papel === p} disabled={eu && p !== "gestor"} onChange={() => setPapel(p)} />
                    {ROTULO_PAPEL[p]}
                  </span>
                  <span className="text-xs text-ink-muted">{DESCRICAO_PAPEL[p]}</span>
                </label>
              ))}
            </div>
            {eu && <p className="text-xs text-ink-muted">Você não pode tirar o próprio papel de gestor — peça a outro gestor.</p>}
          </div>

          {papel === "analista" && (
            <div className="space-y-1.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium text-ink-primary">Empresas que vê ({marcadas.size})</span>
                <span className="space-x-2 text-xs">
                  <button type="button" className="text-ink-muted hover:text-ink-primary hover:underline" onClick={() => setMarcadas(new Set(empresasVisiveis.map((e) => e.id).concat(Array.from(marcadas))))}>
                    marcar as da busca
                  </button>
                  <button type="button" className="text-ink-muted hover:text-ink-primary hover:underline" onClick={() => setMarcadas(new Set())}>
                    limpar
                  </button>
                </span>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-ink-muted" />
                <input
                  value={buscaEmp}
                  onChange={(e) => setBuscaEmp(e.target.value)}
                  placeholder="Buscar empresa"
                  className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-2"
                />
              </div>
              <div className="max-h-56 overflow-y-auto rounded-md border border-border">
                {empresasVisiveis.map((e) => (
                  <label key={e.id} className="flex cursor-pointer items-baseline gap-2 px-3 py-1.5 hover:bg-muted">
                    <input type="checkbox" checked={marcadas.has(e.id)} onChange={() => alterna(e.id)} />
                    <span className="text-ink-primary">{e.name}</span>
                    <span className="text-xs text-ink-muted">{e.ativos > 0 ? `${e.ativos} ativos` : "sem quadro"}</span>
                  </label>
                ))}
              </div>
              {marcadas.size === 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">Sem nenhuma empresa marcada, a pessoa entra no módulo e não vê nada.</p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <button type="button" className={botaoCls} disabled={pending} onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className={primarioCls} disabled={pending || !userId} onClick={salvar}>
            <Plus className="h-4 w-4" /> {pending ? "Salvando…" : atual ? "Salvar" : "Conceder"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
