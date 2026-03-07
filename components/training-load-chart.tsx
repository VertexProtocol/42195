"use client"

import { useMemo } from "react"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts"
import { computeTrainingLoad } from "@/lib/training-utils"
import type { Activity } from "@/lib/types"

interface TrainingLoadChartProps {
  activities: Activity[]
}

export function TrainingLoadChart({ activities }: TrainingLoadChartProps) {
  const data = useMemo(() => computeTrainingLoad(activities), [activities])

  if (data.length < 7) return null

  const formatDate = (d: string) => {
    const date = new Date(d + "T12:00:00")
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }

  return (
    <section>
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Fitness & Fatigue
      </h3>
      <div className="rounded-2xl bg-card p-4 shadow-sm ring-1 ring-border">
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
            <XAxis
              dataKey="date"
              tickFormatter={formatDate}
              tick={{ fontSize: 9 }}
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={40}
            />
            <YAxis
              tick={{ fontSize: 9 }}
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <Tooltip
              labelFormatter={formatDate}
              formatter={(value: number, name: string) => [
                value.toFixed(1),
                name === "ctl" ? "Fitness (CTL)" : name === "atl" ? "Fatigue (ATL)" : "Form (TSB)",
              ]}
              contentStyle={{ fontSize: 11 }}
            />
            <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="3 3" />
            <Area
              type="monotone"
              dataKey="ctl"
              name="ctl"
              stroke="var(--chart-4)"
              fill="var(--chart-4)"
              fillOpacity={0.1}
              strokeWidth={2}
              dot={false}
            />
            <Area
              type="monotone"
              dataKey="atl"
              name="atl"
              stroke="var(--chart-5)"
              fill="var(--chart-5)"
              fillOpacity={0.1}
              strokeWidth={1.5}
              dot={false}
              strokeDasharray="4 2"
            />
            <Area
              type="monotone"
              dataKey="tsb"
              name="tsb"
              stroke="var(--chart-1)"
              fill="var(--chart-1)"
              fillOpacity={0.05}
              strokeWidth={1.5}
              dot={false}
            />
            <Legend
              iconSize={8}
              wrapperStyle={{ fontSize: 10 }}
              formatter={(value: string) =>
                value === "ctl" ? "Fitness" : value === "atl" ? "Fatigue" : "Form"
              }
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
