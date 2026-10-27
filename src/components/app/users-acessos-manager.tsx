"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Loader2,
  MailPlus,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState, type ReactNode } from "react";

import {
  ExceptionsDialog,
  HeaderFilter,
  OrcamentoSetoresPorEmpresaField,
  PillMultiSelect,
} from "@/components/app/users-admin-manager";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AVISO_EMPRESA_RESERVADA, empresaReservada } from "@/lib/auth/concessao-reservada";
import {
  describeUserExceptions,
  findOrphanExceptionRules,
  type UserException,
} from "@/lib/auth/user-exceptions";
import type { CtrlOrgRole } from "@/lib/ctrl/roles";
import {
  comprasExigeSetor,
  FORM_VAZIO,
  PERFIS_COMPRAS,
  PERFIS_DP,
  PERFIS_FINANCEIRO,
  PERFIS_ORCAMENTO,
  rotuloPerfil,
  validarAcessos,
  type AcessosForm,
  type OpcaoPerfil,
} from "@/lib/usuarios/acessos";

// Tela de Usuários MÓDULO → PERFIL (docs/superpowers/specs/
// 2026-10-26-usuarios-modulo-perfil.md): primeiro o módulo, depois o perfil
// dentro dele, depois empresa e setor. Admin marca tudo e desabilita o resto —
// MENOS o Departamento Pessoal, que admin não herda e que só o Lucas concede
// (`reservado`). Para os demais admins a seção do DP não existe, nem no
// filtro nem no catálogo de regras, e as empresas reservadas não podem ser
// marcadas (@/lib/auth/concessao-reservada).
// As regras (formulário inicial, validação, plano de gravação) moram em
// @/lib/usuarios/acessos, puro e testado; esta tela só as desenha.

export interface UsuarioTela {
  id: string;
  email: string;
  name: string;
  phone: string;
  position: string;
  active: boolean;
  canViagens: boolean;
  canViagensAprovar: boolean;
  vbRole: string | null;
  form: AcessosForm;
  /** O que muda só de abrir e salvar — ver acessosIniciais. */
  avisos: string[];
}

interface Opcao {
  id: string;
  name: string;
}

interface Props {
  /** Quem está na tela concede o DP e as empresas reservadas (só o Lucas). */
  reservado: boolean;
  usuarios: UsuarioTela[];
  companies: Opcao[];
  ctrlOrgs: Opcao[];
  /** Setores do Compras, com a empresa do Compras a que pertencem. */
  ctrlSectors: Array<Opcao & { orgId: string | null }>;
  /** Setores do ORÇAMENTO por empresa, pelo nome. */
  orcamentoSetores: Record<string, string[]>;
}

interface Cadastro {
  email: string;
  name: string;
  phone: string;
  position: string;
}

const CADASTRO_VAZIO: Cadastro = { email: "", name: "", phone: "", position: "" };

/** Resumo de uma linha da lista: um item por módulo, com o perfil. */
function resumoAcessos(u: UsuarioTela, reservado: boolean): string[] {
  const f = u.form;
  // Para quem concede o DP, o admin aparece com o DP à parte (ele não o herda).
  // Para os demais, o DP não existe na tela.
  if (f.admin) {
    if (!reservado) return ["Admin (todos os módulos)"];
    if (!f.dp.ativo) return ["Admin (sem o DP)"];
    const empresasDp = f.dp.todasEmpresas ? "todas as empresas" : `${f.dp.empresas.length} empresa(s)`;
    return ["Admin", `Departamento Pessoal · ${rotuloPerfil("dp", f.dp.perfil)} · ${empresasDp}`];
  }
  const out: string[] = [];
  if (f.financeiro.ativo) out.push(`Financeiro · ${rotuloPerfil("financeiro", f.financeiro.perfil)}`);
  if (f.orcamento.ativo) out.push(`Orçamento · ${rotuloPerfil("orcamento", f.orcamento.perfil)}`);
  if (f.compras.ativo) out.push(`Compras · ${rotuloPerfil("compras", f.compras.perfil)}`);
  if (f.caixa) out.push("Caixa");
  if (f.case) out.push("Case");
  if (f.contratos) out.push("Validação de Contratos");
  if (f.dp.ativo) out.push(`Departamento Pessoal · ${rotuloPerfil("dp", f.dp.perfil)}`);
  // Fora da tela, mas não pode sumir da vista de quem confere acessos.
  if (u.vbRole) out.push(`Viva Bank (${u.vbRole})`);
  if (u.canViagens) out.push(u.canViagensAprovar ? "Viagens (aprova)" : "Viagens");
  return out;
}

const MODULOS_FILTRO = [
  { value: "financeiro", label: "Financeiro" },
  { value: "orcamento", label: "Orçamento" },
  { value: "compras", label: "Compras" },
  { value: "caixa", label: "Caixa" },
  { value: "case", label: "Case" },
  { value: "contratos", label: "Validação de Contratos" },
  { value: "dp", label: "Departamento Pessoal" },
] as const;

function temModulo(f: AcessosForm, m: string): boolean {
  // Admin tem tudo, menos o DP: esse só com a concessão.
  if (f.admin && m !== "dp") return true;
  switch (m) {
    case "financeiro":
      return f.financeiro.ativo;
    case "orcamento":
      return f.orcamento.ativo;
    case "compras":
      return f.compras.ativo;
    case "caixa":
      return f.caixa;
    case "case":
      return f.case;
    case "contratos":
      return f.contratos;
    case "dp":
      return f.dp.ativo;
    default:
      return false;
  }
}

export function UsersAcessosManager({ reservado, usuarios, companies, ctrlOrgs, ctrlSectors, orcamentoSetores }: Props) {
  const router = useRouter();
  const [editando, setEditando] = useState<UsuarioTela | null>(null);
  const [convidando, setConvidando] = useState(false);
  const [cadastro, setCadastro] = useState<Cadastro>(CADASTRO_VAZIO);
  const [form, setForm] = useState<AcessosForm>(FORM_VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [excecoesDe, setExcecoesDe] = useState<string | null>(null);

  const [filtroNome, setFiltroNome] = useState("");
  const [filtroModulo, setFiltroModulo] = useState("all");
  const [filtroStatus, setFiltroStatus] = useState("all");

  const excecoesPorUsuario = useMemo(() => {
    const map = new Map<string, UserException[]>();
    for (const u of usuarios) {
      const lista = describeUserExceptions({ id: u.id, email: u.email, name: u.name }, { verDp: reservado });
      if (lista.length > 0) map.set(u.id, lista);
    }
    return map;
  }, [usuarios, reservado]);
  const regrasOrfas = useMemo(
    () => findOrphanExceptionRules(usuarios.map((u) => ({ id: u.id, email: u.email }))),
    [usuarios],
  );

  const filtrados = useMemo(() => {
    const q = filtroNome.trim().toLowerCase();
    return usuarios.filter((u) => {
      if (q && !`${u.name} ${u.position} ${u.email} ${u.phone}`.toLowerCase().includes(q)) return false;
      if (filtroStatus !== "all" && u.active !== (filtroStatus === "active")) return false;
      if (filtroModulo !== "all" && !temModulo(u.form, filtroModulo)) return false;
      return true;
    });
  }, [usuarios, filtroNome, filtroModulo, filtroStatus]);

  function abrirConvite() {
    setCadastro(CADASTRO_VAZIO);
    setForm(FORM_VAZIO);
    setErro(null);
    setConvidando(true);
  }

  function abrirEdicao(u: UsuarioTela) {
    setCadastro({ email: u.email, name: u.name, phone: u.phone, position: u.position });
    setForm(structuredClone(u.form));
    setErro(null);
    setEditando(u);
  }

  function fechar() {
    if (salvando) return;
    setEditando(null);
    setConvidando(false);
    setErro(null);
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (convidando && !cadastro.email.trim()) return setErro("Informe o e-mail.");
    if (!cadastro.name.trim()) return setErro("Informe o nome.");
    const v = validarAcessos(form, { verDp: reservado, novo: convidando });
    if (v) return setErro(v);

    setSalvando(true);
    setErro(null);
    const res = await fetch(convidando ? "/api/users/acessos" : `/api/users/${editando!.id}/acessos`, {
      method: convidando ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(convidando ? { email: cadastro.email.trim() } : {}),
        name: cadastro.name.trim(),
        phone: cadastro.phone.trim() || null,
        position: cadastro.position.trim() || null,
        acessos: form,
      }),
    });
    const payload = await res.json().catch(() => ({}));
    setSalvando(false);
    if (!res.ok) return setErro(payload?.error ?? "Falha ao salvar.");
    setEditando(null);
    setConvidando(false);
    router.refresh();
  }

  async function alternarAtivo(u: UsuarioTela) {
    await fetch(`/api/users/${u.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !u.active }),
    });
    router.refresh();
  }

  const aberto = convidando || editando !== null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Usuários</h2>
          <p className="text-sm text-muted-foreground">
            Escolha os módulos de cada pessoa e, dentro de cada módulo, o perfil, as empresas e os setores.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="whitespace-nowrap text-sm text-muted-foreground">
            {filtrados.length} de {usuarios.length} {usuarios.length === 1 ? "usuário" : "usuários"}
          </span>
          <Button variant="outline" onClick={() => setExcecoesDe("")} title="Regras especiais definidas no código">
            <ShieldAlert className="mr-2 h-4 w-4 text-amber-600" />
            Regras especiais
            {excecoesPorUsuario.size > 0 && (
              <span className="ml-2 rounded-full bg-amber-100 px-1.5 text-xs font-semibold text-amber-800">
                {excecoesPorUsuario.size}
              </span>
            )}
          </Button>
          <Button onClick={abrirConvite}>
            <MailPlus className="mr-2 h-4 w-4" />
            Convidar usuário
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-[220px]">
                <Input
                  value={filtroNome}
                  onChange={(e) => setFiltroNome(e.target.value)}
                  placeholder="Nome, cargo ou contato"
                  className="h-8"
                />
              </TableHead>
              <TableHead className="min-w-[260px]">
                <HeaderFilter
                  value={filtroModulo}
                  onChange={setFiltroModulo}
                  title="Acessos"
                  options={[
                    { value: "all", label: "Todos os módulos" },
                    ...MODULOS_FILTRO.filter((m) => reservado || m.value !== "dp"),
                  ]}
                />
              </TableHead>
              <TableHead>
                <HeaderFilter
                  value={filtroStatus}
                  onChange={setFiltroStatus}
                  title="Status"
                  options={[
                    { value: "all", label: "Todos os status" },
                    { value: "active", label: "Ativo" },
                    { value: "inactive", label: "Inativo" },
                  ]}
                />
              </TableHead>
              <TableHead className="text-right">
                {(filtroNome || filtroModulo !== "all" || filtroStatus !== "all") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8"
                    onClick={() => {
                      setFiltroNome("");
                      setFiltroModulo("all");
                      setFiltroStatus("all");
                    }}
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    Limpar
                  </Button>
                )}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtrados.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium">{u.name || "—"}</span>
                    {excecoesPorUsuario.has(u.id) && (
                      <button
                        type="button"
                        onClick={() => setExcecoesDe(u.id)}
                        title="Este usuário tem regras especiais definidas no código — clique para ver"
                        className="rounded p-0.5 text-amber-600 transition-colors hover:bg-amber-100 hover:text-amber-800"
                      >
                        <ShieldAlert className="h-3.5 w-3.5" />
                        <span className="sr-only">Ver regras especiais</span>
                      </button>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{u.position || u.email}</div>
                  {u.position && <div className="text-xs text-muted-foreground">{u.email}</div>}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {resumoAcessos(u, reservado).map((t) => (
                      <Badge
                        key={t}
                        variant="outline"
                        className={u.form.admin ? "border-violet-200 bg-violet-50 text-violet-800" : "font-normal"}
                      >
                        {t}
                      </Badge>
                    ))}
                    {resumoAcessos(u, reservado).length === 0 && <span className="text-xs text-muted-foreground">—</span>}
                  </div>
                  {u.avisos.length > 0 && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-amber-700">
                      <AlertTriangle className="h-3 w-3" />
                      Muda ao salvar — abra para ver
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={u.active ? "default" : "outline"}
                    className={u.active ? "border-transparent bg-emerald-500 text-white" : ""}
                  >
                    {u.active ? "Ativo" : "Inativo"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => abrirEdicao(u)} title="Editar">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => alternarAtivo(u)}
                      title={u.active ? "Desativar" : "Reativar"}
                    >
                      {u.active ? <ShieldX className="h-3.5 w-3.5" /> : <Check className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtrados.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                  {usuarios.length === 0 ? "Nenhum usuário cadastrado." : "Nenhum usuário encontrado com os filtros aplicados."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <ExceptionsDialog
        open={excecoesDe !== null}
        focusUserId={excecoesDe || null}
        users={usuarios}
        exceptionsByUser={excecoesPorUsuario}
        orphanRules={regrasOrfas}
        onClose={() => setExcecoesDe(null)}
      />

      <Dialog open={aberto} onOpenChange={(o) => !o && fechar()}>
        <DialogContent className="grid max-h-[90vh] max-w-3xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden">
          <DialogHeader>
            <DialogTitle>{convidando ? "Convidar usuário" : "Editar usuário"}</DialogTitle>
            <DialogDescription>
              {convidando
                ? "Um convite por e-mail é enviado. O usuário define a senha no primeiro acesso."
                : `${editando?.email} — alterar os acessos não envia novo convite.`}
            </DialogDescription>
          </DialogHeader>

          <form id="acessos-form" onSubmit={salvar} className="min-h-0 space-y-4 overflow-y-auto pr-1">
            {erro && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>
            )}

            {editando && editando.avisos.length > 0 && (
              <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200">
                <p className="flex items-center gap-1.5 font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5" />O que muda ao salvar
                </p>
                {editando.avisos.map((a) => (
                  <p key={a}>{a}</p>
                ))}
              </div>
            )}

            <CamposCadastro cadastro={cadastro} incluiEmail={convidando} onChange={setCadastro} />

            {editando && excecoesPorUsuario.has(editando.id) && (
              <div className="rounded-md border border-amber-200 px-3 py-2 text-xs">
                <p className="mb-1 flex items-center gap-1.5 font-semibold text-amber-800 dark:text-amber-300">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Regras especiais deste usuário (valem além do que está marcado aqui)
                </p>
                <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                  {excecoesPorUsuario.get(editando.id)!.map((ex) => (
                    <li key={ex.key}>{ex.title}</li>
                  ))}
                </ul>
              </div>
            )}

            <EditorAcessos
              form={form}
              reservado={reservado}
              onChange={setForm}
              companies={companies}
              ctrlOrgs={ctrlOrgs}
              ctrlSectors={ctrlSectors}
              orcamentoSetores={orcamentoSetores}
            />
          </form>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={fechar} disabled={salvando}>
              Cancelar
            </Button>
            <Button type="submit" form="acessos-form" disabled={salvando}>
              {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
              {convidando ? "Enviar convite" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Cadastro (nome, e-mail, cargo, telefone) ───────────────────────────────

function CamposCadastro({
  cadastro,
  incluiEmail,
  onChange,
}: {
  cadastro: Cadastro;
  incluiEmail: boolean;
  onChange: (c: Cadastro) => void;
}) {
  const set = (k: keyof Cadastro, v: string) => onChange({ ...cadastro, [k]: v });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {incluiEmail && (
        <div className="space-y-1.5">
          <Label htmlFor="acessos-email">
            E-mail <span className="text-destructive">*</span>
          </Label>
          <Input
            id="acessos-email"
            type="email"
            required
            value={cadastro.email}
            onChange={(e) => set("email", e.target.value)}
            placeholder="usuario@empresa.com"
          />
        </div>
      )}
      <div className={`space-y-1.5 ${incluiEmail ? "" : "sm:col-span-2"}`}>
        <Label htmlFor="acessos-nome">
          Nome completo <span className="text-destructive">*</span>
        </Label>
        <Input
          id="acessos-nome"
          required
          value={cadastro.name}
          onChange={(e) => set("name", e.target.value)}
          placeholder="Ex: Maria da Silva"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="acessos-cargo">Cargo</Label>
        <Input id="acessos-cargo" value={cadastro.position} onChange={(e) => set("position", e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="acessos-telefone">Telefone</Label>
        <Input id="acessos-telefone" type="tel" value={cadastro.phone} onChange={(e) => set("phone", e.target.value)} />
      </div>
    </div>
  );
}

// ─── Editor de acessos: Admin → módulos → perfil → empresa → setor ───────────

function EditorAcessos({
  form,
  reservado,
  onChange,
  companies,
  ctrlOrgs,
  ctrlSectors,
  orcamentoSetores,
}: {
  form: AcessosForm;
  /** Quem está na tela concede o DP e as empresas reservadas (só o Lucas). */
  reservado: boolean;
  onChange: (f: AcessosForm) => void;
  companies: Opcao[];
  ctrlOrgs: Opcao[];
  ctrlSectors: Array<Opcao & { orgId: string | null }>;
  orcamentoSetores: Record<string, string[]>;
}) {
  const off = form.admin;
  // Empresa reservada: quem não é o Lucas não MARCA (desmarcar segue livre). O servidor confere de novo.
  const travadaReservada = reservado ? undefined : (id: string) => (empresaReservada(id) ? AVISO_EMPRESA_RESERVADA : null);

  const alternar = (lista: string[], id: string) =>
    lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id];

  function alternarEmpresaCompras(orgId: string) {
    const removendo = form.compras.empresas.includes(orgId);
    const empresas = alternar(form.compras.empresas, orgId);
    // Tirar a empresa tira junto os setores e o papel dela: senão sobraria
    // acesso a um setor de uma empresa que a pessoa não abre.
    const orgDoSetor = new Map(ctrlSectors.map((s) => [s.id, s.orgId]));
    const setores = form.compras.setores.filter((s) => {
      const org = orgDoSetor.get(s);
      return org != null && empresas.includes(org);
    });
    const papelPorEmpresa = { ...form.compras.papelPorEmpresa };
    if (removendo) delete papelPorEmpresa[orgId];
    onChange({ ...form, compras: { ...form.compras, empresas, setores, papelPorEmpresa } });
  }

  function definirPapelNaEmpresa(orgId: string, papel: CtrlOrgRole | null) {
    const papelPorEmpresa = { ...form.compras.papelPorEmpresa };
    if (papel === null) delete papelPorEmpresa[orgId];
    else papelPorEmpresa[orgId] = papel;
    onChange({ ...form, compras: { ...form.compras, papelPorEmpresa } });
  }

  return (
    <div className="space-y-3">
      <Label className="text-sm">Acessos</Label>

      {/* Admin: marca tudo e desabilita o resto. */}
      <button
        type="button"
        onClick={() => onChange({ ...form, admin: !form.admin })}
        className={`flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors ${
          form.admin ? "border-violet-300 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/30" : "hover:bg-muted"
        }`}
      >
        <Marca ativo={form.admin} />
        <span>
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-violet-600" />
            Admin
          </span>
          <span className="block text-xs text-muted-foreground">
            Acesso a todos os módulos e a todas as empresas, inclusive Usuários e Configurações.
            {reservado && " O Departamento Pessoal não vem junto: ele é marcado à parte, abaixo."}
          </span>
        </span>
      </button>

      <div className={off ? "pointer-events-none space-y-3 opacity-50" : "space-y-3"} aria-disabled={off}>
        {off && (
          <p className="text-xs text-muted-foreground">
            Com o Admin marcado, os módulos abaixo ficam desabilitados: o acesso já é total.
          </p>
        )}

        {/* 1. Financeiro */}
        <CartaoModulo
          titulo="Financeiro"
          ativo={form.financeiro.ativo}
          onAlternar={() => onChange({ ...form, financeiro: { ...form.financeiro, ativo: !form.financeiro.ativo } })}
        >
          <EscolhaPerfil
            opcoes={PERFIS_FINANCEIRO}
            valor={form.financeiro.perfil}
            onEscolher={(perfil) => onChange({ ...form, financeiro: { ...form.financeiro, perfil } })}
          />
          <Bloco titulo="Empresas" obrigatorio>
            <PillMultiSelect
              options={companies}
              selected={form.financeiro.empresas}
              onToggle={(id) =>
                onChange({ ...form, financeiro: { ...form.financeiro, empresas: alternar(form.financeiro.empresas, id) } })
              }
              emptyMessage="Nenhuma empresa cadastrada."
              travado={travadaReservada}
            />
          </Bloco>
        </CartaoModulo>

        {/* 2. Orçamento */}
        <CartaoModulo
          titulo="Orçamento"
          ativo={form.orcamento.ativo}
          onAlternar={() => onChange({ ...form, orcamento: { ...form.orcamento, ativo: !form.orcamento.ativo } })}
        >
          <EscolhaPerfil
            opcoes={PERFIS_ORCAMENTO}
            valor={form.orcamento.perfil}
            onEscolher={(perfil) => onChange({ ...form, orcamento: { ...form.orcamento, perfil } })}
          />
          <Bloco titulo="Empresas" obrigatorio>
            <PillMultiSelect
              options={companies}
              selected={form.orcamento.empresas}
              onToggle={(id) => {
                const empresas = alternar(form.orcamento.empresas, id);
                const setores = Object.fromEntries(
                  Object.entries(form.orcamento.setores).filter(([c]) => empresas.includes(c)),
                );
                onChange({ ...form, orcamento: { ...form.orcamento, empresas, setores } });
              }}
              emptyMessage="Nenhuma empresa cadastrada."
              travado={travadaReservada}
            />
          </Bloco>
          <Bloco titulo="Setores, por empresa">
            <OrcamentoSetoresPorEmpresaField
              companies={companies}
              setoresPorEmpresa={orcamentoSetores}
              companyIds={form.orcamento.empresas}
              value={form.orcamento.setores}
              onChange={(setores) => onChange({ ...form, orcamento: { ...form.orcamento, setores } })}
            />
            <p className="text-xs text-muted-foreground">
              Sem setor numa empresa, o Preenchedor não vê nada dela; o Preenchedor amplo e o Aprovador veem a
              empresa inteira, mas só preenchem os setores marcados.
            </p>
          </Bloco>
        </CartaoModulo>

        {/* 3. Compras */}
        <CartaoModulo
          titulo="Compras"
          ativo={form.compras.ativo}
          onAlternar={() => onChange({ ...form, compras: { ...form.compras, ativo: !form.compras.ativo } })}
        >
          <EscolhaPerfil
            opcoes={PERFIS_COMPRAS}
            valor={form.compras.perfil}
            onEscolher={(perfil) => onChange({ ...form, compras: { ...form.compras, perfil } })}
          />
          <Bloco titulo="Empresas" obrigatorio>
            <PillMultiSelect
              options={ctrlOrgs}
              selected={form.compras.empresas}
              onToggle={alternarEmpresaCompras}
              emptyMessage="Nenhuma empresa do Compras cadastrada."
            />
            {form.compras.empresas.length > 1 && form.compras.perfil && (
              <div className="mt-1 space-y-2 rounded-md border p-2.5">
                <p className="text-xs text-muted-foreground">
                  Perfil em cada empresa. O padrão é o perfil escolhido acima (
                  <strong>{rotuloPerfil("compras", form.compras.perfil)}</strong>); mude só se uma empresa precisar.
                </p>
                {form.compras.empresas.map((orgId) => (
                  <div key={orgId} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 break-words text-sm">
                      {ctrlOrgs.find((o) => o.id === orgId)?.name ?? orgId}
                    </span>
                    <Select
                      value={form.compras.papelPorEmpresa[orgId] ?? "__perfil__"}
                      onValueChange={(v) => definirPapelNaEmpresa(orgId, v === "__perfil__" ? null : (v as CtrlOrgRole))}
                    >
                      <SelectTrigger className="h-8 w-56 shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__perfil__">
                          Usar o perfil ({rotuloPerfil("compras", form.compras.perfil)})
                        </SelectItem>
                        {PERFIS_COMPRAS.map((p) => (
                          <SelectItem key={p.value} value={p.value}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            )}
          </Bloco>
          <Bloco titulo="Setores" obrigatorio={comprasExigeSetor(form.compras.perfil)}>
            {form.compras.empresas.length === 0 ? (
              <p className="text-xs text-muted-foreground">Marque uma empresa acima para ver os setores.</p>
            ) : (
              <div className="space-y-2">
                {ctrlOrgs
                  .filter((o) => form.compras.empresas.includes(o.id))
                  .map((o) => (
                    <div key={o.id} className="space-y-1">
                      {form.compras.empresas.length > 1 && (
                        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{o.name}</p>
                      )}
                      <PillMultiSelect
                        options={ctrlSectors.filter((s) => s.orgId === o.id)}
                        selected={form.compras.setores}
                        onToggle={(id) =>
                          onChange({ ...form, compras: { ...form.compras, setores: alternar(form.compras.setores, id) } })
                        }
                        emptyMessage="Nenhum setor cadastrado nesta empresa."
                      />
                    </div>
                  ))}
              </div>
            )}
            {form.compras.perfil === "diretor" && (
              <p className="text-xs text-muted-foreground">
                Diretor: com setores marcados, vê só esses; sem nenhum, vê todos.
              </p>
            )}
          </Bloco>
        </CartaoModulo>

        {/* 4–6. Módulos sem perfil */}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <ModuloSimples titulo="Caixa" ativo={form.caixa} onAlternar={() => onChange({ ...form, caixa: !form.caixa })} />
          <ModuloSimples titulo="Case" ativo={form.case} onAlternar={() => onChange({ ...form, case: !form.case })} />
          <ModuloSimples
            titulo="Validação de Contratos"
            ativo={form.contratos}
            onAlternar={() => onChange({ ...form, contratos: !form.contratos })}
          />
        </div>
        {form.caixa && (
          <p className="text-xs text-muted-foreground">
            O Caixa mostra o saldo das contas correntes de <strong>todas as empresas</strong>.
          </p>
        )}

      </div>

      {/* 7. Departamento Pessoal — fora do bloco do Admin: admin não o herda. Só
          quem o concede (o Lucas) vê esta seção; para os demais ela não existe. */}
      {reservado && (
        <CartaoModulo
          titulo="Departamento Pessoal"
          ativo={form.dp.ativo}
          onAlternar={() => onChange({ ...form, dp: { ...form.dp, ativo: !form.dp.ativo } })}
        >
          <EscolhaPerfil
            opcoes={PERFIS_DP}
            valor={form.dp.perfil}
            onEscolher={(perfil) => onChange({ ...form, dp: { ...form.dp, perfil } })}
          />
          {/* Admin escolhe entre todas as empresas e só as marcadas (27/10/2026); os demais, só as marcadas. */}
          {form.admin && (
            <ModuloSimples
              titulo="Todas as empresas (inclusive as que forem criadas)"
              ativo={form.dp.todasEmpresas}
              onAlternar={() => onChange({ ...form, dp: { ...form.dp, todasEmpresas: !form.dp.todasEmpresas } })}
            />
          )}
          {form.admin && form.dp.todasEmpresas ? (
            <p className="text-xs text-muted-foreground">Vê o DP de todas as empresas. Desmarque para escolher quais.</p>
          ) : (
            <Bloco titulo="Empresas" obrigatorio>
              <PillMultiSelect
                options={companies}
                selected={form.dp.empresas}
                onToggle={(id) => onChange({ ...form, dp: { ...form.dp, empresas: alternar(form.dp.empresas, id) } })}
                emptyMessage="Nenhuma empresa cadastrada."
              />
            </Bloco>
          )}
        </CartaoModulo>
      )}
    </div>
  );
}

function Marca({ ativo }: { ativo: boolean }) {
  return (
    <span
      className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
        ativo ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"
      }`}
    >
      {ativo && <Check className="h-3 w-3" />}
    </span>
  );
}

function CartaoModulo({
  titulo,
  ativo,
  onAlternar,
  children,
}: {
  titulo: string;
  ativo: boolean;
  onAlternar: () => void;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-md border ${ativo ? "border-primary/40" : ""}`}>
      <button
        type="button"
        onClick={onAlternar}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-muted/50"
      >
        <Marca ativo={ativo} />
        <span className="text-sm font-medium">{titulo}</span>
      </button>
      {ativo && <div className="space-y-3 border-t px-3 py-3">{children}</div>}
    </div>
  );
}

function ModuloSimples({ titulo, ativo, onAlternar }: { titulo: string; ativo: boolean; onAlternar: () => void }) {
  return (
    <button
      type="button"
      onClick={onAlternar}
      className={`flex items-center gap-3 rounded-md border px-3 py-2.5 text-left text-sm font-medium transition-colors ${
        ativo ? "border-primary/40" : "hover:bg-muted/50"
      }`}
    >
      <Marca ativo={ativo} />
      {titulo}
    </button>
  );
}

function Bloco({ titulo, obrigatorio, children }: { titulo: string; obrigatorio?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">
        {titulo} {obrigatorio && <span className="text-destructive">*</span>}
      </p>
      {children}
    </div>
  );
}

function EscolhaPerfil<T extends string>({
  opcoes,
  valor,
  onEscolher,
}: {
  opcoes: ReadonlyArray<OpcaoPerfil<T>>;
  valor: T | null;
  onEscolher: (v: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">
        Perfil <span className="text-destructive">*</span>
      </p>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {opcoes.map((p) => {
          const ativo = valor === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => onEscolher(p.value)}
              className={`rounded-md border px-2.5 py-2 text-left transition-colors ${
                ativo ? "border-primary bg-primary/10" : "hover:bg-muted"
              }`}
            >
              <span className={`block text-sm font-medium ${ativo ? "text-primary" : ""}`}>{p.label}</span>
              <span className="block text-xs text-muted-foreground">{p.description}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
