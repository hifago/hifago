"use client";

import { CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "@hifago/ui";
import { formatCop } from "@hifago/domain";

export function SalesChart({ data }: { data: Array<{ day: string; ventas: number }> }) {
  return (
    <ChartCard title="Evolución de ventas" testId="chart-sales">
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="day" tick={{ fontSize: 11 }} minTickGap={20} />
        <YAxis tick={{ fontSize: 11 }} width={70} tickFormatter={(v) => formatCop(v)} />
        <Tooltip formatter={(value) => formatCop(Number(value))} />
        <Line type="monotone" dataKey="ventas" stroke="var(--charte-bleu-moyen)" dot={false} strokeWidth={2} />
      </LineChart>
    </ChartCard>
  );
}
