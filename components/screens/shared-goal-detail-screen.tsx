"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ArrowLeft,
  UserPlus,
  Users,
  Trophy,
  Flame,
  Target,
  CalendarCheck,
  MapPin,
  Loader2,
  Clock,
  LogOut,
  Trash2,
  AlertCircle,
} from "lucide-react"
import { formatDistance, formatDate, daysUntil, isDatePast } from "@/lib/format"
import type { Goal } from "@/lib/types"
import { AppCard } from "@/components/ui/app-card"
import { InviteMemberSheet } from "@/components/social/invite-member-sheet"

interface LinkedGoal {
  id: string
  name: string
  target_distance_km: number
  current_distance_km: number
  target_date: string
  start_date: string | null
}

interface RecentActivity {
  id: string
  type: string
  name: string
  date: string
  distance_km: number
  duration_seconds: number
  pace_min_per_km: number | null
}

interface Member {
  id: string
  user_id: string
  goal_id: string | null
  status: "pending" | "accepted" | "declined"
  role: "owner" | "member"
  display_name: string
  avatar_url: string | null
  linked_goal: LinkedGoal | null
  week_distance_km: number
  week_sessions: number
  recent_activities: RecentActivity[]
}

interface SharedGoal {
  id: string
  name: string
  target_date: string
  target_distance_km: number
  created_by: string
  created_at: string
}

interface ShareResponse {
  share: SharedGoal
  members: Member[]
  my_membership: Member | null
}

interface Props {
  sharedGoalId: string
  currentUserId: string
  myGoals: Goal[]
  onBack: () => void
}

/** Compute a team-wide "virtual route" progress. The combined km of all
 * accepted members toward a shared total of N·target_distance_km. */
function computeTeamProgress(members: Member[], targetPerPerson: number) {
  const accepted = members.filter((m) => m.status === "accepted")
  const totalKm = accepted.reduce(
    (sum, m) => sum + (m.linked_goal?.current_distance_km ?? 0),
    0,
  )
  const target = accepted.length * targetPerPerson
  return {
    accepted,
    totalKm: Number(totalKm.toFixed(1)),
    target: Number(target.toFixed(1)),
    pct: target > 0 ? Math.min(100, (totalKm / target) * 100) : 0,
  }
}

/** Simple gamification: crown the member with the highest weekly km. */
function pickWeeklyLeader(members: Member[]) {
  const accepted = members.filter((m) => m.status === "accepted")
  if (accepted.length < 2) return null
  const leader = accepted.reduce(
    (best, m) => (m.week_distance_km > best.week_distance_km ? m : best),
    accepted[0],
  )
  if (leader.week_distance_km <= 0) return null
  return leader
}

export function SharedGoalDetailScreen({ sharedGoalId, currentUserId, myGoals, onBack }: Props) {
  const [data, setData] = useState<ShareResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [acting, setActing] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/goal-shares/${sharedGoalId}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Status ${res.status}`)
      }
      setData(await res.json())
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [sharedGoalId])

  useEffect(() => {
    load()
  }, [load])

  const team = useMemo(
    () => (data ? computeTeamProgress(data.members, data.share.target_distance_km) : null),
    [data],
  )
  const weeklyLeader = useMemo(() => (data ? pickWeeklyLeader(data.members) : null), [data])

  const isOwner = data?.my_membership?.role === "owner"
  const share = data?.share
  const days = share ? daysUntil(share.target_date) : 0
  const past = share ? isDatePast(share.target_date) : false

  const handleLeave = async () => {
    if (!data) return
    setActing(true)
    try {
      const res = await fetch(`/api/goal-shares/${sharedGoalId}/members`, { method: "DELETE" })
      if (!res.ok) throw new Error("Kunne ikke forlate felles mål")
      onBack()
    } catch (err) {
      setError((err as Error).message)
      setActing(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm("Slette dette felles målet for alle medlemmer?")) return
    setActing(true)
    try {
      const res = await fetch(`/api/goal-shares/${sharedGoalId}`, { method: "DELETE" })
      if (!res.ok) throw new Error("Kunne ikke slette")
      onBack()
    } catch (err) {
      setError((err as Error).message)
      setActing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Laster felles mål…</p>
      </div>
    )
  }

  if (error || !data || !share || !team) {
    return (
      <div className="flex flex-col gap-4 px-5 pt-4">
        <button onClick={onBack} className="flex items-center gap-1.5 self-start text-sm font-medium text-primary">
          <ArrowLeft size={18} /> Tilbake
        </button>
        <AppCard>
          <div className="flex items-start gap-2 p-4">
            <AlertCircle size={18} className="mt-0.5 text-destructive" />
            <div>
              <p className="font-medium text-foreground">Kunne ikke laste felles mål</p>
              <p className="mt-1 text-sm text-muted-foreground">{error ?? "Ukjent feil"}</p>
            </div>
          </div>
        </AppCard>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 px-5 pb-8 pt-4">
      <button onClick={onBack} className="flex items-center gap-1.5 self-start text-sm font-medium text-primary">
        <ArrowLeft size={18} />
        <span>Felles mål</span>
      </button>

      {/* Header */}
      <header className="flex flex-col gap-2">
        <div className="inline-flex items-center gap-1.5">
          <Users size={14} className="text-primary" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">Felles mål</span>
        </div>
        <h1 className="text-2xl font-bold leading-tight">{share.name}</h1>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><MapPin size={13} /> {formatDistance(share.target_distance_km)}</span>
          <span className="flex items-center gap-1"><CalendarCheck size={13} /> {formatDate(share.target_date)}</span>
          {!past && days > 0 && (
            <span className="rounded-full bg-secondary px-2 py-0.5 font-semibold text-foreground">
              {days} dager igjen
            </span>
          )}
        </div>
      </header>

      {/* Team combined progress (gamification) */}
      <AppCard>
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Felles distanse
              </p>
              <p className="mt-1 text-2xl font-bold tabular-nums">
                {team.totalKm.toFixed(1)} km
                <span className="ml-1 text-sm font-normal text-muted-foreground">/ {team.target.toFixed(0)} km</span>
              </p>
            </div>
            <div className="flex size-12 items-center justify-center rounded-full bg-primary/10">
              <Target size={20} className="text-primary" />
            </div>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-all duration-500"
              style={{ width: `${team.pct}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {team.accepted.length} medlem{team.accepted.length === 1 ? "" : "mer"} på vei mot {formatDistance(share.target_distance_km)} hver
          </p>
        </div>
      </AppCard>

      {/* Weekly leader badge (gamification) */}
      {weeklyLeader && (
        <div className="flex items-center gap-3 rounded-2xl bg-amber-500/10 p-3 ring-1 ring-amber-500/20">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20">
            <Trophy size={18} className="text-amber-500" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-500">
              Ukens leder
            </p>
            <p className="truncate text-sm font-semibold text-foreground">
              {weeklyLeader.display_name}
              <span className="ml-1.5 font-normal text-muted-foreground">
                · {weeklyLeader.week_distance_km.toFixed(1)} km denne uka
              </span>
            </p>
          </div>
        </div>
      )}

      {/* Members */}
      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Medlemmer
        </h2>

        {data.members.map((m) => (
          <MemberCard key={m.id} member={m} isMe={m.user_id === currentUserId} />
        ))}

        {isOwner && !past && (
          <button
            onClick={() => setInviteOpen(true)}
            className="flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border py-3 text-sm font-medium text-muted-foreground active:bg-secondary transition-colors"
          >
            <UserPlus size={18} />
            Inviter medlem
          </button>
        )}
      </section>

      {/* Bottom actions */}
      <div className="mt-4 flex flex-col gap-2 pt-2 text-center">
        {isOwner ? (
          <button
            onClick={handleDelete}
            disabled={acting}
            className="flex items-center justify-center gap-1.5 text-xs text-destructive active:opacity-70 disabled:opacity-40"
          >
            <Trash2 size={13} /> Slett felles mål
          </button>
        ) : (
          <>
            {!confirmLeave ? (
              <button
                onClick={() => setConfirmLeave(true)}
                className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground active:text-destructive"
              >
                <LogOut size={13} /> Forlat felles mål
              </button>
            ) : (
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={() => setConfirmLeave(false)}
                  className="rounded-lg bg-secondary px-3 py-1.5 text-xs font-medium active:opacity-80"
                >
                  Avbryt
                </button>
                <button
                  onClick={handleLeave}
                  disabled={acting}
                  className="rounded-lg bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground active:opacity-80 disabled:opacity-40"
                >
                  Ja, forlat
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {inviteOpen && (
        <InviteMemberSheet
          sharedGoalId={sharedGoalId}
          onClose={() => setInviteOpen(false)}
          onInvited={() => {
            setInviteOpen(false)
            load()
          }}
        />
      )}
    </div>
  )
}

// ----------------------------------------------------------

function MemberCard({ member, isMe }: { member: Member; isMe: boolean }) {
  const goal = member.linked_goal
  const personalPct = goal && goal.target_distance_km > 0
    ? Math.min(100, (goal.current_distance_km / goal.target_distance_km) * 100)
    : 0

  if (member.status === "pending") {
    return (
      <AppCard>
        <div className="flex items-center gap-3 p-3">
          <Avatar name={member.display_name} url={member.avatar_url} />
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{member.display_name}</p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <Clock size={11} /> Venter på svar
            </p>
          </div>
        </div>
      </AppCard>
    )
  }

  if (member.status === "declined") {
    return (
      <AppCard>
        <div className="flex items-center gap-3 p-3 opacity-60">
          <Avatar name={member.display_name} url={member.avatar_url} />
          <div className="flex-1 min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{member.display_name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">Avslo invitasjonen</p>
          </div>
        </div>
      </AppCard>
    )
  }

  return (
    <AppCard state={isMe ? "active" : "idle"}>
      <div className="flex flex-col gap-3 p-3">
        {/* Header row */}
        <div className="flex items-center gap-3">
          <Avatar name={member.display_name} url={member.avatar_url} />
          <div className="flex-1 min-w-0">
            <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-foreground">
              {member.display_name}
              {isMe && <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">Deg</span>}
              {member.role === "owner" && (
                <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                  Eier
                </span>
              )}
            </p>
            {goal && (
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {goal.name}
              </p>
            )}
          </div>
        </div>

        {/* Personal plan progress */}
        {goal && (
          <div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground tabular-nums">
                {goal.current_distance_km.toFixed(1)} km logget
              </span>
              <span className="font-medium tabular-nums text-foreground">
                {personalPct.toFixed(0)}%
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${personalPct}%` }}
              />
            </div>
          </div>
        )}

        {/* This week */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-secondary/60 px-2.5 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Uka
            </p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
              {member.week_distance_km.toFixed(1)} km
            </p>
          </div>
          <div className="rounded-lg bg-secondary/60 px-2.5 py-2">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Økter
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-sm font-semibold tabular-nums text-foreground">
              <Flame size={12} className="text-orange-500" />
              {member.week_sessions}
            </p>
          </div>
        </div>

        {/* Recent activities (compact) */}
        {member.recent_activities.length > 0 && (
          <div className="border-t border-border pt-2">
            <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Siste økter
            </p>
            <ul className="flex flex-col gap-1">
              {member.recent_activities.slice(0, 3).map((a) => (
                <li key={a.id} className="flex items-center justify-between text-xs">
                  <span className="truncate text-foreground">{a.name}</span>
                  <span className="ml-2 shrink-0 tabular-nums text-muted-foreground">
                    {a.distance_km.toFixed(1)} km
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </AppCard>
  )
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase() ?? "")
    .join("") || "R"

  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="size-10 shrink-0 rounded-full object-cover" />
  }
  return (
    <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-primary/10 text-sm font-semibold text-primary">
      {initials}
    </div>
  )
}
