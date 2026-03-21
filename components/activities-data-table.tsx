"use client"

import { useState, useMemo } from "react"
import { ChevronUp, ChevronDown, ChevronsUpDown, FlaskConical } from "lucide-react"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ActivityTypeBadge } from "@/components/activity-type-badge"
import { formatDistance, formatDuration, formatPace, formatDateShort } from "@/lib/format"
import type { Activity } from "@/lib/types"
import { useI18n } from "@/lib/i18n"

type SortKey = "date" | "distance_km" | "duration_seconds" | "pace_min_per_km" | "elevation_gain_m"
type SortDir = "asc" | "desc"

interface ActivitiesDataTableProps {
  activities: Activity[]
  testRunActivityIds: Set<string>
  onSelectActivity: (activity: Activity) => void
}

function SortIcon({ column, sortKey, sortDir }: { column: SortKey; sortKey: SortKey | null; sortDir: SortDir }) {
  if (sortKey !== column) return <ChevronsUpDown size={13} className="ml-1 inline text-muted-foreground/50" />
  return sortDir === "asc"
    ? <ChevronUp size={13} className="ml-1 inline text-foreground" />
    : <ChevronDown size={13} className="ml-1 inline text-foreground" />
}

export function ActivitiesDataTable({ activities, testRunActivityIds, onSelectActivity }: ActivitiesDataTableProps) {
  const { t } = useI18n()
  const [sortKey, setSortKey] = useState<SortKey | null>("date")
  const [sortDir, setSortDir] = useState<SortDir>("desc")

  const hasElevation = activities.some((a) => a.elevation_gain_m !== null && a.elevation_gain_m > 0)
  const hasHR = activities.some((a) => a.avg_heart_rate !== null)

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(key)
      setSortDir("desc")
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return activities
    return [...activities].sort((a, b) => {
      let aVal: number
      let bVal: number
      if (sortKey === "date") {
        aVal = new Date(a.date).getTime()
        bVal = new Date(b.date).getTime()
      } else {
        aVal = (a[sortKey] ?? 0) as number
        bVal = (b[sortKey] ?? 0) as number
      }
      return sortDir === "asc" ? aVal - bVal : bVal - aVal
    })
  }, [activities, sortKey, sortDir])

  function SortableHead({ col, children, className }: { col: SortKey; children: React.ReactNode; className?: string }) {
    return (
      <TableHead
        className={`cursor-pointer select-none hover:text-foreground ${className ?? ""}`}
        onClick={() => toggleSort(col)}
      >
        {children}
        <SortIcon column={col} sortKey={sortKey} sortDir={sortDir} />
      </TableHead>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <SortableHead col="date">Date</SortableHead>
          <TableHead>Type</TableHead>
          <TableHead>Name</TableHead>
          <SortableHead col="distance_km" className="text-right">Distance</SortableHead>
          <SortableHead col="duration_seconds" className="text-right">Duration</SortableHead>
          <SortableHead col="pace_min_per_km" className="text-right">Pace</SortableHead>
          {hasElevation && (
            <SortableHead col="elevation_gain_m" className="text-right">Elev.</SortableHead>
          )}
          {hasHR && (
            <TableHead className="text-right">HR</TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((activity) => (
          <TableRow
            key={activity.id}
            className="cursor-pointer"
            onClick={() => onSelectActivity(activity)}
          >
            <TableCell className="text-muted-foreground text-xs">
              {formatDateShort(activity.date)}
            </TableCell>
            <TableCell>
              <ActivityTypeBadge type={activity.type} />
            </TableCell>
            <TableCell className="font-medium max-w-[160px] truncate">
              <span className="flex items-center gap-1.5">
                <span className="truncate">{activity.name}</span>
                {testRunActivityIds.has(activity.id) && (
                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-violet-600 dark:text-violet-400 ring-1 ring-violet-500/20">
                    <FlaskConical size={9} />
                    {t("testRun.badge")}
                  </span>
                )}
              </span>
            </TableCell>
            <TableCell className="text-right font-medium">
              {formatDistance(activity.distance_km)}
            </TableCell>
            <TableCell className="text-right text-muted-foreground">
              {formatDuration(activity.duration_seconds)}
            </TableCell>
            <TableCell className="text-right text-muted-foreground">
              {formatPace(activity.pace_min_per_km)}
            </TableCell>
            {hasElevation && (
              <TableCell className="text-right text-muted-foreground">
                {activity.elevation_gain_m ? `${Math.round(activity.elevation_gain_m)} m` : "—"}
              </TableCell>
            )}
            {hasHR && (
              <TableCell className="text-right text-muted-foreground">
                {activity.avg_heart_rate ? `${activity.avg_heart_rate} bpm` : "—"}
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
