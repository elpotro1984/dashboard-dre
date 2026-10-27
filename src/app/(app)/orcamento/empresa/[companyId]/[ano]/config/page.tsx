import { ConfigHub } from "@/components/orcamento/config-hub";
import { alcancaEmpresaNoDp } from "@/lib/orcamento/dp-fonte";

export const dynamic = "force-dynamic";

// Sub-hub de Configuração da empresa (caixas das seções de config por empresa).
// Empresa + ano vêm da rota; o guard admin e o cabeçalho ficam no layout pai.
export default async function OrcamentoEmpresaConfigHubPage({
  params,
}: {
  params: { companyId: string; ano: string };
}) {
  // O card "Colaboradores do DP" só aparece nas empresas que o usuário alcança
  // no Departamento Pessoal — quem administra o Orçamento costuma ver mais
  // empresas do que o DP lhe libera. Quem recusa de verdade é `autorizarSyncDp`.
  const alcancaDp = await alcancaEmpresaNoDp(params.companyId);

  return <ConfigHub companyId={params.companyId} year={Number(params.ano)} alcancaDp={alcancaDp} />;
}
