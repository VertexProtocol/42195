"use client"

import {
  useState,
  useMemo,
  useEffect,
  useRef,
  useCallback,
  useReducer,
  useSyncExternalStore,
} from "react"
import {
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Plus,
  Search,
  X,
  Check,
  TriangleAlert,
  FlaskConical,
  Route,
} from "lucide-react"
import { formatDistance, formatDuration, formatPace, formatDateShort } from "@/lib/format"
import type { Activity, SyncStatus } from "@/lib/types"
import { syncCooldownRemainingMs } from "@/lib/sync-constants"
import { useI18n } from "@/lib/i18n"
import { PoweredByStrava } from "@/components/strava-brand"
import { AppCard, CardRow } from "@/components/ui/app-card"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"
import { Pill } from "@/components/ui/pill"

/**
 * Activities — a log, read as a list.
 *
 * Every run is one row on one surface. The old layout gave each run its own
 * floating card, which spent a whole card's worth of elevation on "here is
 * another Tuesday" and made a long history read as noise. Rows on a single
 * card scan; a stack of cards does not.
 */

interface ActivitiesScreenProps {
  activities: Activity[]
  stravaConnected: boolean
  syncStatus: SyncStatus
  /**
   * Owned by the app shell, not fetched here. This screen unmounts on every
   * tab change, so fetching it on mount made the test-run filter chip appear a
   * round-trip late — shifting the chip row — each time the tab was opened.
   */
  testRunActivityIds: Set<string>
  onSelectActivity: (activity: Activity) => void
  onSync: () => void
  onAddActivity: () => void
}

const PULL_THRESHOLD = 80

/**
 * Rows rendered before the list asks. A season of running is hundreds of rows,
 * and a phone renders every one of them whether or not the runner scrolls that
 * far — the log is read from the top, so the tail is paid for and never seen.
 *
 * The runner picks the step. There is no "all": that is the one setting that
 * would undo the paging entirely, and the list is long precisely for the people
 * who would reach for it.
 */
const PAGE_SIZE_OPTIONS = [10, 25, 50] as const
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number]
const DEFAULT_PAGE_SIZE: PageSize = 25
const PAGE_SIZE_STORAGE_KEY = "activities.pageSize"

function isPageSize(value: unknown): value is PageSize {
  return PAGE_SIZE_OPTIONS.includes(value as PageSize)
}

/**
 * The stored preference, or the default when there is nothing readable.
 *
 * Only ever called once the component knows it is on the client. Reading
 * localStorage during the first render would make the server and the client
 * disagree about how many rows the list has, and this screen is handed real
 * activities by the server — the mismatch would be a whole list of them.
 */
function storedPageSize(): PageSize {
  try {
    const raw = Number(localStorage.getItem(PAGE_SIZE_STORAGE_KEY))
    return isPageSize(raw) ? raw : DEFAULT_PAGE_SIZE
  } catch {
    return DEFAULT_PAGE_SIZE
  }
}

/** useSyncExternalStore arguments for "has this rendered on the client yet". */
const NEVER_CHANGES = () => () => {}
const onClient = () => true
const onServer = () => false

export function ActivitiesScreen({
  activities,
  stravaConnected,
  syncStatus,
  testRunActivityIds,
  onSelectActivity,
  onSync,
  onAddActivity,
}: ActivitiesScreenProps) {
  const { t } = useI18n()
  const [searchQuery, setSearchQuery] = useState("")
  const [selectedType, setSelectedType] = useState<string>("all")
  // A sync asked for inside the cooldown is turned away by the server, so for
  // exactly that long the button says "Synced" and does not invite the press.
  // This replaced a three-second confirmation that expired while the sync was
  // still being declined, leaving a live-looking button that could only fail.
  //
  // Derived during render rather than held in state: the clock is the source,
  // and the effect's only job is to ask for one more render at the moment the
  // cooldown lapses.
  const [, tick] = useReducer((n: number) => n + 1, 0)
  const coolingDown = syncCooldownRemainingMs(syncStatus.last_sync_at) > 0
  useEffect(() => {
    const remaining = syncCooldownRemainingMs(syncStatus.last_sync_at)
    if (remaining <= 0) return
    const timer = setTimeout(tick, remaining)
    return () => clearTimeout(timer)
  }, [syncStatus.last_sync_at])

  const isSyncing = syncStatus.state === "syncing"
  const syncSuccess = coolingDown && syncStatus.state === "success"

  // ---- Pull to refresh -----------------------------------------------------
  // The page scrolls on the document, so the gesture arms off window scroll
  // position rather than a container's scrollTop.
  const touchStartY = useRef(0)
  const isPulling = useRef(false)
  const [pullDistance, setPullDistance] = useState(0)

  const onTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (window.scrollY > 0 || isSyncing || coolingDown || !stravaConnected) return
      touchStartY.current = e.touches[0].clientY
      isPulling.current = true
    },
    [isSyncing, coolingDown, stravaConnected],
  )

  const onTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling.current) return
    const dy = e.touches[0].clientY - touchStartY.current
    if (dy > 0) setPullDistance(Math.min(dy * 0.5, PULL_THRESHOLD * 1.5))
  }, [])

  const onTouchEnd = useCallback(() => {
    if (!isPulling.current) return
    isPulling.current = false
    if (pullDistance >= PULL_THRESHOLD && stravaConnected && !isSyncing && !coolingDown) {
      onSync()
    }
    setPullDistance(0)
  }, [pullDistance, stravaConnected, isSyncing, coolingDown, onSync])

  // Only offer filters for types that actually exist, most frequent first.
  const activityTypes = useMemo(() => {
    const counts = new Map<string, number>()
    for (const a of activities) counts.set(a.type, (counts.get(a.type) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([type]) => type)
  }, [activities])

  const filteredActivities = useMemo(() => {
    return activities.filter((activity) => {
      if (selectedType === "__test_run__") {
        if (!testRunActivityIds.has(activity.id)) return false
      } else if (selectedType !== "all" && activity.type !== selectedType) {
        return false
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase()
        return (
          activity.name.toLowerCase().includes(query) ||
          activity.type.toLowerCase().includes(query)
        )
      }
      return true
    })
  }, [activities, searchQuery, selectedType, testRunActivityIds])

  const hasActiveFilters = searchQuery.trim() !== "" || selectedType !== "all"

  // How many rows one step shows. Null until the runner picks one this
  // session, at which point their choice wins over whatever was stored.
  const hydrated = useSyncExternalStore(NEVER_CHANGES, onClient, onServer)
  const [chosenPageSize, setChosenPageSize] = useState<PageSize | null>(null)
  const rememberedPageSize = useMemo(
    () => (hydrated ? storedPageSize() : DEFAULT_PAGE_SIZE),
    [hydrated],
  )
  const pageSize = chosenPageSize ?? rememberedPageSize

  // Counted in steps rather than rows so that changing the step size cannot
  // leave the list on a count that belongs to the old one.
  const [extraSteps, setExtraSteps] = useState(0)
  const visibleCount = pageSize * (extraSteps + 1)

  // Filtering re-ranks the whole log, so an unfolded list from the previous
  // query would be showing page four of a result set the runner never saw.
  // Folded back during render rather than in an effect: an effect would paint
  // the old page count once before correcting itself.
  //
  // The separator is a unit separator written as an escape. It used to be a
  // literal NUL byte: equally impossible in a type name or a typed query, but a
  // NUL in the source makes grep and ripgrep classify this entire file as
  // binary and skip it, so searches for anything on this screen came back empty.
  const filterKey = `${searchQuery}\u001F${selectedType}`
  const [lastFilterKey, setLastFilterKey] = useState(filterKey)
  if (filterKey !== lastFilterKey) {
    setLastFilterKey(filterKey)
    setExtraSteps(0)
  }

  const handlePageSizeChange = (size: PageSize) => {
    setChosenPageSize(size)
    setExtraSteps(0)
    try {
      localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(size))
    } catch {
      // A runner with storage blocked still gets the choice, just not the memory of it.
    }
  }

  const visibleActivities = useMemo(
    () => filteredActivities.slice(0, visibleCount),
    [filteredActivities, visibleCount],
  )
  const remaining = filteredActivities.length - visibleActivities.length

  // Nothing to choose when even the smallest step shows the whole result set.
  const canChoosePageSize = filteredActivities.length > PAGE_SIZE_OPTIONS[0]

  return (
    <div
      className="flex flex-col gap-5 px-4 pb-8 screen-body"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {pullDistance > 0 && stravaConnected && (
        <div
          className="flex items-center justify-center overflow-hidden"
          style={{ height: pullDistance, opacity: Math.min(pullDistance / PULL_THRESHOLD, 1) }}
          aria-hidden
        >
          <RefreshCw
            size={18}
            className={pullDistance >= PULL_THRESHOLD ? "text-primary" : "text-muted-foreground"}
            style={{ transform: `rotate(${pullDistance * 3}deg)` }}
          />
        </div>
      )}

      {/* Actions sit above the list rather than inside the app bar: syncing is
          a decision about this screen's contents. */}
      <div className="flex items-center gap-2">
        {stravaConnected && (
          <Button
            variant={syncSuccess ? "ghost" : "secondary"}
            size="sm"
            className={`flex-1 ${syncSuccess ? "text-success" : ""}`}
            onClick={onSync}
            loading={isSyncing}
            disabled={isSyncing || coolingDown}
          >
            {!isSyncing && (syncSuccess ? <Check size={14} /> : <RefreshCw size={14} />)}
            {isSyncing
              ? t("profile.syncing")
              : syncSuccess
                ? t("profile.synced")
                : t("activities.syncStrava")}
          </Button>
        )}
        <Button
          size="sm"
          className={stravaConnected ? "" : "flex-1"}
          onClick={onAddActivity}
        >
          <Plus size={16} />
          {t("activities.addActivity")}
        </Button>
      </div>

      {syncStatus.state === "error" && syncStatus.error_message && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2.5"
        >
          <TriangleAlert size={15} className="mt-px shrink-0 text-destructive" aria-hidden />
          <div className="min-w-0">
            <p className="text-label font-medium text-destructive">{t("sync.failed")}</p>
            <p className="mt-0.5 text-micro text-destructive/90">{syncStatus.error_message}</p>
          </div>
        </div>
      )}

      {activities.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              type="search"
              placeholder={t("activities.search")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label={t("activities.search")}
              className="h-11 w-full rounded-md bg-surface-sunken pl-9 pr-10 text-base text-foreground outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                aria-label={t("activities.clearFilters")}
                className="press absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {/* Type filters are always visible: hiding them behind a toggle made
              the current filter invisible from the list itself. */}
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-0.5">
            <FilterChip
              active={selectedType === "all"}
              onClick={() => setSelectedType("all")}
              label={t("activities.allTypes")}
            />
            {testRunActivityIds.size > 0 && (
              <FilterChip
                active={selectedType === "__test_run__"}
                onClick={() => setSelectedType("__test_run__")}
                label={t("testRun.badge")}
                icon={<FlaskConical size={12} />}
              />
            )}
            {activityTypes.map((type) => (
              <FilterChip
                key={type}
                active={selectedType === type}
                onClick={() => setSelectedType(type)}
                label={type}
              />
            ))}
          </div>

          {hasActiveFilters && (
            <p className="text-micro text-muted-foreground" role="status">
              {t("activities.showing")} {filteredActivities.length} {t("activities.of")}{" "}
              {activities.length}
            </p>
          )}
        </div>
      )}

      {activities.length === 0 ? (
        <EmptyState
          icon={<Route size={18} />}
          title={t("activities.noActivities")}
          body={stravaConnected ? t("activities.syncDesc") : t("activities.connectDesc")}
          action={
            stravaConnected ? (
              <Button
                onClick={onSync}
                loading={isSyncing}
                disabled={isSyncing || coolingDown}
              >
                {!isSyncing && <RefreshCw size={16} />}
                {isSyncing ? t("profile.syncing") : t("activities.syncStrava")}
              </Button>
            ) : (
              <Button asChild>
                <a href="/api/auth/strava">{t("activities.connectStrava")}</a>
              </Button>
            )
          }
        />
      ) : filteredActivities.length === 0 ? (
        <EmptyState
          icon={<Search size={18} />}
          title={t("activities.noResults")}
          body={t("activities.noResultsBody")}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setSearchQuery("")
                setSelectedType("all")
              }}
            >
              {t("activities.clearFilters")}
            </Button>
          }
        />
      ) : (
        <>
          <AppCard variant="rows">
            {visibleActivities.map((activity) => (
              <CardRow key={activity.id} className="p-0">
                <button
                  onClick={() => onSelectActivity(activity)}
                  className="press flex w-full items-center gap-3 px-4 py-3.5 text-left"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-label font-semibold text-card-foreground">
                        {activity.name}
                      </p>
                      {testRunActivityIds.has(activity.id) && (
                        <Pill tone="data" icon={<FlaskConical size={10} />}>
                          {t("testRun.badge")}
                        </Pill>
                      )}
                    </div>
                    <p className="mt-0.5 text-micro text-muted-foreground">
                      {formatDateShort(activity.date)} · {activity.type}
                    </p>
                    <p className="measure mt-1.5 text-micro text-muted-foreground">
                      <span className="text-label font-semibold text-foreground">
                        {formatDistance(activity.distance_km)}
                      </span>
                      {"  "}
                      {formatDuration(activity.duration_seconds)}
                      {activity.pace_min_per_km !== null && (
                        <> · {formatPace(activity.pace_min_per_km)}</>
                      )}
                    </p>
                  </div>
                  <ChevronRight
                    size={16}
                    className="shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                </button>
              </CardRow>
            ))}
          </AppCard>

          {(remaining > 0 || canChoosePageSize) && (
            <div className="flex flex-col items-center gap-3">
              {remaining > 0 && (
                <div className="flex flex-col items-center gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setExtraSteps((n) => n + 1)}
                  >
                    {t("activities.showMore")}
                  </Button>
                  {/* The rendered count, not the filtered one the chips report —
                      two different questions, so they never share a phrasing. */}
                  <p className="measure text-micro text-muted-foreground" role="status">
                    {visibleActivities.length} {t("activities.of")} {filteredActivities.length}
                  </p>
                </div>
              )}

              {/* Sits under the button rather than up with the filters: it is
                  the answer to "this is too many" / "not enough", which is a
                  thought the runner has at the bottom of the list. It stays put
                  once the whole list fits, or there would be no way back. */}
              {/* One pill, not a row of three. Three chips gave a utility
                  setting the same weight as the type filters above the list,
                  and the two options the runner is not on were permanent
                  furniture. A native select also means the phone renders its
                  own picker rather than a popover pretending to be one. */}
              {canChoosePageSize && (
                <label className="flex items-center gap-2 text-micro text-muted-foreground">
                  {t("activities.perPage")}
                  <span className="press relative inline-flex items-center rounded-full bg-surface-sunken pl-3 pr-7 text-label font-semibold text-secondary-foreground">
                    {pageSize}
                    <ChevronDown
                      size={13}
                      className="pointer-events-none absolute right-2.5 text-muted-foreground"
                      aria-hidden
                    />
                    {/* The real control, laid over the pill: the native select
                        keeps the keyboard and the platform picker, the span
                        keeps the shape. */}
                    <select
                      value={pageSize}
                      onChange={(e) => handlePageSizeChange(Number(e.target.value) as PageSize)}
                      className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    >
                      {PAGE_SIZE_OPTIONS.map((size) => (
                        <option key={size} value={size}>
                          {size}
                        </option>
                      ))}
                    </select>
                  </span>
                </label>
              )}
            </div>
          )}
        </>
      )}

      {stravaConnected && activities.length > 0 && <PoweredByStrava className="pt-1" />}
    </div>
  )
}

function FilterChip({
  active,
  onClick,
  label,
  icon,
}: {
  active: boolean
  onClick: () => void
  label: string
  icon?: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-micro font-semibold ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-surface-sunken text-secondary-foreground hover:bg-accent"
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
