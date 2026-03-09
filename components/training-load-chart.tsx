"use client"

import { useMemo, useState } from "react"
import {
  AreaChart,
  Area,
  XAxis,
  ResponsiveContainer,
  Tooltip,
} from "recharts"
import { ChevronDown } from "lucide-react"
import { computeTrainingLoad } from "@/lib/training-utils"
import type { Activity } from "@/lib/types"

interface TrainingLoadChartProps {
  activities: Activity[]
}

function getFormStatus(tsb: number): {
  label: string
  description: string
  color: string
  bg: string
} {
  if (tsb > 15) return { label: "Fresh", description: "Well rested, ready to push harder", color: "text-blue-500", bg: "bg-blue-500" }
  if (tsb > 5) return { label: "Optimal", description: "Great balance of fitness and recovery", color: "text-emerald-500", bg: "bg-emerald-500" }
  if (tsb > -5) return { label: "Neutral", description: "Maintaining current fitness level", color: "text-yellow-500", bg: "bg-yellow-500" }
  if (tsb > -15) return { label: "Tired", description: "Building fitness — recovery needed soon", color: "text-orange-500", bg: "bg-orange-500" }
  return { label: "Overreaching", description: "High fatigue — prioritize rest", color: "text-red-500", bg: "bg-red-500" }
}

export function TrainingLoadChart({ activities }: TrainingLoadChartProps) {
  const [chartExpanded, setChartExpanded] = useState(false)
  const data = useMemo(() => computeTrainingLoad(activities), [activities])

  if (data.length < 7) return null

  const latest = data[data.length - 1]
  const status = getFormStatus(latest.tsb)

  // Compute trend: compare current fitness to 14 days ago
  const twoWeeksAgo = data[Math.max(0, data.length - 15)]
  const fitnessDelta = latest.ctl - twoWeeksAgo.ctl
  const fitnessArrow = fitnessDelta > 0.3 ? "↑" : fitnessDelta < -0.3 ? "↓" : "→"

  const formatDate = (d: string) => {
    const date = new Date(d + "T12:00:00")
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
  }

  return (
    <section>
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Training Status
      </h3>
      <div className="rounded-2xl bg-card shadow-sm ring-1 ring-border overflow-hidden">
        {/* Status Header */}
        <div className="px-4 pt-4 pb-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className={`h-2.5 w-2.5 rounded-full ${status.bg}`} />
              <span className={`text-sm font-semibold ${status.color}`}>{status.label}</span>
            </div>
            <span className="text-xs text-muted-foreground">
              Fitness {fitnessArrow} {latest.ctl.toFixed(1)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">{status.description}</p>
        </div>

        {/* Metrics Row */}
        <div className="grid grid-cols-3 border-t border-border/50 divide-x divide-border/50">
          <div className="px-3 py-2.5 text-center">
            <div className="text-xs text-muted-foreground mb-0.5">Fitness</div>
            <div className="text-sm font-semibold font-mono text-card-foreground">{latest.ctl.toFixed(1)}</div>
          </div>
          <div className="px-3 py-2.5 text-center">
            <div className="text-xs text-muted-foreground mb-0.5">Fatigue</div>
            <div className="text-sm font-semibold font-mono text-card-foreground">{latest.atl.toFixed(1)}</div>
          </div>
          <div className="px-3 py-2.5 text-center">
            <div className="text-xs text-muted-foreground mb-0.5">Form</div>
            <div className={`text-sm font-semibold font-mono ${status.color}`}>
              {latest.tsb > 0 ? "+" : ""}{latest.tsb.toFixed(1)}
            </div>
          </div>
        </div>

        {/* Chart Toggle Button */}
        <button
          onClick={() => setChartExpanded(!chartExpanded)}
          className="flex w-full items-center justify-center gap-1.5 border-t border-border/50 py-2 text-xs text-muted-foreground active:bg-muted/30 transition-colors"
        >
          <span>{chartExpanded ? "Hide chart" : "Show chart"}</span>
          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ${chartExpanded ? "rotate-180" : ""}`}
          />
        </button>

        {/* Collapsible Chart */}
        <div
          className={`grid transition-all duration-300 ease-in-out ${
            chartExpanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className="overflow-hidden">
            <div className="px-2 pb-2 pt-1">
              <ResponsiveContainer width="100%" height={120}>
                <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fitnessGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.2} />
                      <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="fatigueGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--chart-5)" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="var(--chart-5)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDate}
                    tick={{ fontSize: 9, fill: "var(--muted-foreground)" }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                    minTickGap={50}
                  />
                  <Tooltip
                    labelFormatter={formatDate}
                    formatter={(value: number, name: string) => [
                      value.toFixed(1),
                      name === "ctl" ? "Fitness" : "Fatigue",
                    ]}
                    contentStyle={{
                      fontSize: 11,
                      borderRadius: 8,
                      border: "1px solid var(--border)",
                      background: "var(--card)",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="ctl"
                    name="ctl"
                    stroke="var(--chart-2)"
                    fill="url(#fitnessGrad)"
                    strokeWidth={2}
                    dot={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="atl"
                    name="atl"
                    stroke="var(--chart-5)"
                    fill="url(#fatigueGrad)"
                    strokeWidth={1.5}
                    dot={false}
                    strokeDasharray="4 2"
                  />
                </AreaChart>
              </ResponsiveContainer>
              {/* Inline Legend */}
              <div className="flex items-center justify-center gap-4 pt-1 pb-1">
                <div className="flex items-center gap-1.5">
                  <div className="h-0.5 w-3 rounded-full" style={{ background: "var(--chart-2)" }} />
                  <span className="text-[10px] text-muted-foreground">Fitness</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="h-0.5 w-3 rounded-full" style={{ background: "var(--chart-5)", opacity: 0.7 }} />
                  <span className="text-[10px] text-muted-foreground">Fatigue</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
