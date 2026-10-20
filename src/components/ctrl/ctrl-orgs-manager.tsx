"use client";

// Painel admin "Empresas do Compras" (Plataforma). Cria orgs (ctrl_orgs), anexa
// CNPJs (ctrl_org_companies) e liga/desliga `ativo`. Cada "empresa do Compras" é
// um grupo de CNPJs — a Viva Company junta 5; uma franquia nova pode ter 1.
// As escritas são server actions admin-only; a tela recarrega do servidor após
// cada uma (router.refresh), então a lista de CNPJs disponíveis fica sempre certa.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Check, Pencil, Plus, Power, X } from "lucide-react";

import {
  addCtrlOrgCompany,
  createCtrlOrg,
  removeCtrlOrgCompany,
  renameCtrlOrg,
  setCtrlOrgAtivo,
} from "@/lib/ctrl/actions/org-admin";

interface Company {
  id: string;
  name: string;
}
interface OrgRow {
  id: string;
  nome: string;
  slug: string;
  ativo: boolean;
  companies: Company[];
}

type ActionResult =
  | { ok: true; skipped?: number }
  | { ok: true; orgId: string; skipped: number }
  | { error: string };

export function CtrlOrgsManager({
  orgs,
  available,
}: {
  orgs: OrgRow[];
  available: Company[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Criar
  const [novoNome, setNovoNome] = useState("");
  const [novoSel, setNovoSel] = useState<Set<string>>(new Set());
  // Renomear
  const [editId, setEditId] = useState<string | null>(null);
  const [editNome, setEditNome] = useState("");
  // Adicionar CNPJ por org
  const [addSel, setAddSel] = useState<Record<string, string>>({});

  async function run(p: Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    setNotice(null);
    setLoading(true);
    try {
      const res = await p;
      if ("error" in res) {
        setError(res.error);
        return;
      }
      if ("skipped" in res && res.skipped && res.skipped > 0) {
        setNotice(
          `${res.skipped} empresa(s) não puderam ser anexadas (um CNPJ só entra em uma empresa do Compras).`,
        );
      }
      onOk?.();
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  function toggleNovo(id: string) {
    setNovoSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  const btn =
    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50";
  const btnPrimary =
    "inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:opacity-50";

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6">
      <div className="mb-1 flex items-center gap-2">
        <Building2 className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-lg font-semibold text-foreground">Empresas do Compras</h1>
      </div>
      <p className="mb-5 text-sm text-muted-foreground">
        Cada empresa do Compras é um grupo de CNPJs. Crie a empresa e anexe os CNPJs (um CNPJ
        pertence a uma empresa só). A empresa nasce vazia — setores, orçamento, fornecedores,
        mapeamento Omie e os acessos dos usuários são cadastrados depois, nas telas do módulo.
      </p>

      {error && (
        <div className="mb-4 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          {notice}
        </div>
      )}

      {/* Criar nova empresa do Compras */}
      <div className="mb-6 rounded-lg border bg-background p-4">
        <div className="mb-3 text-sm font-medium text-foreground">Nova empresa do Compras</div>
        <input
          value={novoNome}
          onChange={(e) => setNovoNome(e.target.value)}
          placeholder="Nome da empresa (ex.: Viva Juiz de Fora)"
          className="mb-3 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
        {available.length > 0 ? (
          <div className="mb-3">
            <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              CNPJs a anexar (opcional)
            </div>
            <div className="max-h-44 overflow-y-auto rounded-md border p-1">
              {available.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked={novoSel.has(c.id)}
                    onChange={() => toggleNovo(c.id)}
                    className="h-3.5 w-3.5 rounded border-gray-300"
                  />
                  <span className="truncate">{c.name}</span>
                </label>
              ))}
            </div>
          </div>
        ) : (
          <p className="mb-3 text-xs text-muted-foreground">
            Não há CNPJs livres para anexar — todas as empresas ativas já estão em alguma empresa do
            Compras. Você ainda pode criar a empresa e anexar depois.
          </p>
        )}
        <button
          type="button"
          disabled={loading || !novoNome.trim()}
          className={btnPrimary}
          onClick={() =>
            run(
              createCtrlOrg({ nome: novoNome, companyIds: Array.from(novoSel) }),
              () => {
                setNovoNome("");
                setNovoSel(new Set());
              },
            )
          }
        >
          <Plus className="h-3.5 w-3.5" />
          Criar empresa
        </button>
      </div>

      {/* Lista de empresas do Compras */}
      <div className="space-y-3">
        {orgs.map((org) => {
          const sel = addSel[org.id] ?? "";
          return (
            <div
              key={org.id}
              className={`rounded-lg border bg-background p-4 ${org.ativo ? "" : "opacity-70"}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  {editId === org.id ? (
                    <div className="flex items-center gap-2">
                      <input
                        value={editNome}
                        onChange={(e) => setEditNome(e.target.value)}
                        className="rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
                      />
                      <button
                        type="button"
                        disabled={loading || !editNome.trim()}
                        className={btn}
                        onClick={() =>
                          run(renameCtrlOrg(org.id, editNome), () => setEditId(null))
                        }
                      >
                        <Check className="h-3.5 w-3.5" />
                        Salvar
                      </button>
                      <button type="button" className={btn} onClick={() => setEditId(null)}>
                        Cancelar
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-foreground">{org.nome}</span>
                      {!org.ativo && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                          inativa
                        </span>
                      )}
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground"
                        title="Renomear"
                        onClick={() => {
                          setEditId(org.id);
                          setEditNome(org.nome);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                  <div className="mt-0.5 text-xs text-muted-foreground">slug: {org.slug}</div>
                </div>
                <button
                  type="button"
                  disabled={loading}
                  className={btn}
                  onClick={() => run(setCtrlOrgAtivo(org.id, !org.ativo))}
                  title={org.ativo ? "Desativar (some do seletor do menu)" : "Reativar"}
                >
                  <Power className="h-3.5 w-3.5" />
                  {org.ativo ? "Desativar" : "Reativar"}
                </button>
              </div>

              {/* CNPJs da empresa */}
              <div className="mt-3">
                <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  CNPJs ({org.companies.length})
                </div>
                {org.companies.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nenhum CNPJ anexado — sem CNPJ a empresa não lança no Contas a Pagar.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {org.companies.map((c) => (
                      <span
                        key={c.id}
                        className="inline-flex items-center gap-1 rounded-full border bg-muted/50 px-2 py-0.5 text-xs"
                      >
                        {c.name}
                        <button
                          type="button"
                          disabled={loading}
                          className="text-muted-foreground hover:text-red-600"
                          title="Remover CNPJ"
                          onClick={() => {
                            if (
                              confirm(
                                `Remover "${c.name}" da empresa "${org.nome}"? O CNPJ volta a ficar livre.`,
                              )
                            ) {
                              run(removeCtrlOrgCompany(org.id, c.id));
                            }
                          }}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {available.length > 0 && (
                  <div className="mt-2 flex items-center gap-2">
                    <select
                      value={sel}
                      onChange={(e) => setAddSel((p) => ({ ...p, [org.id]: e.target.value }))}
                      className="rounded-md border bg-background px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="">Anexar CNPJ…</option>
                      {available.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={loading || !sel}
                      className={btn}
                      onClick={() =>
                        run(addCtrlOrgCompany(org.id, sel), () =>
                          setAddSel((p) => ({ ...p, [org.id]: "" })),
                        )
                      }
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Anexar
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
