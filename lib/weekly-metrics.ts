import { Clock, Flame, Mountain, TrendingUp, type LucideIcon } from "lucide-react"
import type { WeeklyGoalMetric } from "@/lib/types"
import type { TranslationKey } from "@/lib/i18n"

/**
 * What a weekly goal looks and reads like, wherever it appears.
 *
 * A weekly target shows up on three screens — as a card on Plan, as a line
 * under a stat on Today, and as a choice in the editor — and it should be
 * recognisable as the same object in all three. The icon is that recognition:
 * a type marker, the way the star marks a pinned race, not a fact about the
 * goal. Both maps lived twice, once per screen, which is how Today ended up
 * with no icons at all.
 */

export const WEEKLY_METRIC_ICONS: Record<WeeklyGoalMetric, LucideIcon> = {
  distance_km: TrendingUp,
  sessions: Flame,
  duration_minutes: Clock,
  elevation_m: Mountain,
}

export const WEEKLY_METRIC_LABEL_KEYS: Record<WeeklyGoalMetric, TranslationKey> = {
  distance_km: "goals.weeklyDistance",
  sessions: "goals.trainingSessions",
  duration_minutes: "goals.activeMinutes",
  elevation_m: "goals.elevationGain",
}
