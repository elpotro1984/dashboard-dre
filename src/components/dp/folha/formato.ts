// Formatação da folha — módulo sem "use client" de propósito: função exportada
// de arquivo client vira referência de client e não pode ser chamada num
// server component (server component que formate valores importa daqui).

export const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const brl0 = (v: number) => (Math.abs(v) < 0.005 ? "—" : brl(v));
