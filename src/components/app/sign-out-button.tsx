"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const handleLogout = async () => {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    // A empresa do Compras e a do DP são escolhidas a cada login: apaga a
    // confirmação deste (o vínculo com o session_id já a invalidaria; isto deixa explícito).
    document.cookie = "ctrl_org_confirmed=; Max-Age=0; path=/";
    document.cookie = "dp_empresa_confirmed=; Max-Age=0; path=/";
    router.replace("/login");
    router.refresh();
  };

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className="ch-btn ch-btn--secondary"
    >
      <LogOut className="h-3.5 w-3.5" strokeWidth={2} />
      {loading ? "Saindo..." : "Sair"}
    </button>
  );
}
