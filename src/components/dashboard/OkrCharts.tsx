"use client";

import {
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  Tooltip,
} from "recharts";
import { formatBaht, formatBahtShort } from "@/lib/grants";

const STATUS_COLORS: Record<string, string> = {
  submitted: "#94a3b8",
  approved: "#3b82f6",
  first_disbursement: "#6366f1",
  in_progress: "#f59e0b",
  reporting: "#8b5cf6",
  closed: "#10b981",
};

export function OkrGauge({ percent }: { percent: number }) {
  const clamped = Math.min(percent, 100);
  const data = [{ name: "okr", value: clamped, fill: "#2563eb" }];
  return (
    <div className="relative h-44">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          innerRadius="72%"
          outerRadius="100%"
          data={data}
          startAngle={90}
          endAngle={-270}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar dataKey="value" cornerRadius={999} background={{ fill: "#eef2f7" }} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <span className="font-display text-3xl font-semibold text-foreground tnum">{percent}%</span>
        <span className="text-xs text-muted-foreground mt-0.5">บรรลุเป้า</span>
      </div>
    </div>
  );
}

export function StatusBarChart({
  data,
}: {
  data: { key: string; label: string; amount: number; count: number }[];
}) {
  const hasData = data.some((d) => d.amount > 0 || d.count > 0);
  if (!hasData) {
    return (
      <div className="h-64 grid place-items-center text-sm text-muted-foreground">
        ยังไม่มีข้อมูลทุน — เพิ่มหรือนำเข้าข้อมูลเพื่อดูกราฟ
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={264}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="label"
          width={96}
          tick={{ fontSize: 12, fill: "#64748b" }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={{ fill: "#f1f5f9" }}
          formatter={(value, _name, item) => {
            const p = item as { payload: { count: number; label: string } };
            return [`${formatBaht(Number(value))} · ${p.payload.count} ทุน`, p.payload.label];
          }}
          contentStyle={{
            borderRadius: 12,
            border: "1px solid #e6ebf2",
            fontSize: 13,
            boxShadow: "0 8px 24px -6px rgb(15 23 42 / 0.12)",
          }}
        />
        <Bar dataKey="amount" radius={[0, 8, 8, 0]} maxBarSize={26} label={renderBarLabel}>
          {data.map((d) => (
            <Cell key={d.key} fill={STATUS_COLORS[d.key] || "#94a3b8"} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderBarLabel(props: any) {
  const x = Number(props.x) || 0;
  const y = Number(props.y) || 0;
  const width = Number(props.width) || 0;
  const height = Number(props.height) || 0;
  const value = Number(props.value) || 0;
  if (!value) return <g />;
  return (
    <text
      x={x + width + 8}
      y={y + height / 2}
      dy={4}
      fontSize={12}
      fill="#64748b"
      className="tnum"
    >
      {formatBahtShort(value)}
    </text>
  );
}
