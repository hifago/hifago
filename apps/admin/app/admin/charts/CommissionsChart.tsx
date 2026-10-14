"use client";

import { Bar, BarChart, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "@hifago/ui";
import { formatCop } from "@hifago/domain";

// Commissions GENERADAS uniquement (lignes fulfilled) — aucun ledger dû/payé n'existe encore côté
// hifago (spec §1, constat 1). Ne jamais renommer en « pagadas » tant que ce n'est pas vrai.
export function CommissionsChart({
  data,
}: {
  data: Array<{ day: string; referente: number; app: number }>;
}) {
  return (
    <ChartCard title="Comisiones generadas (referente vs. app)" testId="chart-commissions">
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="day" tick={{ fontSize: 11 }} minTickGap={20} />
        <YAxis tick={{ fontSize: 11 }} width={70} tickFormatter={(v) => formatCop(v)} />
        <Tooltip formatter={(value) => formatCop(Number(value))} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="referente" stackId="commission" fill="var(--charte-bleu-moyen)" name="Referente" />
        <Bar dataKey="app" stackId="commission" fill="var(--charte-or)" name="App" />
      </BarChart>
    </ChartCard>
  );
}
