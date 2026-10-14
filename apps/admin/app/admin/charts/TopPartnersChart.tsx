"use client";

import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "@hifago/ui";
import { formatCop } from "@hifago/domain";

// Volumen = ventas de los establecimientos del partner (el vendedor), no el referente que trajo
// el pedido — misma lectura que la tabla "Détail par Hostel" del legacy.
export function TopPartnersChart({ data }: { data: Array<{ name: string; total: number }> }) {
  return (
    <ChartCard title="Top partners por volumen" testId="chart-top-partners">
      <BarChart data={data} layout="vertical" margin={{ left: 24 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => formatCop(v)} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={120} />
        <Tooltip formatter={(value) => formatCop(Number(value))} />
        <Bar dataKey="total" fill="var(--charte-bleu-moyen)" />
      </BarChart>
    </ChartCard>
  );
}
