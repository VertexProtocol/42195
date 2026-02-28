# 42195 Training Tracker — Full Deep Analysis

> Exhaustive audit covering flaws/bugs, improvement opportunities, new feature ideas, and frontend UX/performance review. Every finding is tied to specific file paths and line numbers.

---

## Table of Contents

1. [Flaws & Bugs](#1-flaws--bugs)
2. [Improvements to Existing Logic & AI Logic](#2-improvements-to-existing-logic--ai-logic)
3. [New Feature Ideas](#3-new-feature-ideas)
4. [Frontend UX & Performance Audit](#4-frontend-ux--performance-audit)

---

## 1. Flaws & Bugs

### CRITICAL

#### 1.1 Activity Type Interface Missing Fields
**Files:** `lib/types.ts:3-14`, `components/app-shell.tsx:92-107`

The `Activity` interface defines 10 fields, but `AppShell` maps 4 additional fields from the Supabase response that don't exist on the type: `user_id` (line 94), `strava_id` (line 95), `map_polyline` (line 105), `created_at` (line 106). TypeScript is configured with `strict: true`, but `next.config.mjs` has `ignoreBuildErrors: true` — masking what would be compile errors.

**Impact:** Any component receiving an `Activity` object cannot safely access these fields without casting. The `map_polyline` field exists in the DB but can never be used through the type system.

**Fix:** Extend the `Activity` interface:
```typescript
export interface Activity {
  // ... existing fields ...
  user_id?: string
  strava_id?: number | null
  map_polyline?: string | null
  created_at?: string
}
```
And remove `ignoreBuildErrors: true` from `next.config.mjs` to catch future mismatches.

---

#### 1.2 `ignoreBuildErrors: true` in Production Config
**File:** `next.config.mjs:3-4`

```javascript
typescript: { ignoreBuildErrors: true },
```

This suppresses ALL TypeScript errors during builds, meaning broken types, missing imports, and logic errors deploy silently. This is the single highest-risk config issue in the codebase.

**Fix:** Remove `ignoreBuildErrors: true`. Fix all resulting build errors (primarily the Activity type mismatch above).

---

#### 1.3 `images: { unoptimized: true }` Disables Next.js Image Optimization
**File:** `next.config.mjs:5-7`

```javascript
images: { unoptimized: true },
```

Combined with `profile-screen.tsx:79` using raw `<img>` instead of `next/image`, this means:
- No automatic WebP/AVIF conversion
- No lazy loading
- No responsive sizing
- Avatar images served at full resolution on all devices

**Fix:** Remove `unoptimized: true`, switch avatar to `<Image>` component with proper `width`/`height`/`sizes`.

---

#### 1.4 Strava Token Query Fails Silently via Anon Key
**File:** `components/app-shell.tsx:83-87`

```typescript
supabase
  .from("strava_tokens")
  .select("athlete_id")
  .eq("user_id", authUser.id)
  .maybeSingle(),
```

The `strava_tokens` table has NO RLS policies (by design — `scripts/002_create_strava_tokens.sql`). The browser client uses the anon key, so this query returns `null` regardless of whether tokens exist. The code works by accident (treats `null` as "not connected"), but this is misleading and fragile.

**Fix:** Replace with a call to the `sync-status` API endpoint which already checks token existence via the service client, or create a dedicated server action.

---

#### 1.5 Weekly Goal Session Thresholds Ignored During Server-Side Sync
**Files:** `app/api/sync-strava/route.ts:280-302`, `lib/format.ts:138-169`

The client-side `computeWeeklyProgress()` correctly applies `session_min_duration_minutes` and `session_min_distance_km` filters (format.ts:155-158). But the server-side sync recalculation (sync-strava/route.ts:292-297) uses a simple aggregate:

```typescript
const weekTotals = {
  sessions: acts.length, // <-- counts ALL sessions, ignores thresholds
  ...
}
```

**Impact:** After sync, the DB `current` field for session goals will be wrong (too high) if the user has minimum thresholds configured. The client recomputes correctly, but the stale DB value could confuse any future server-side logic or API consumers.

**Fix:** Fetch `session_min_duration_minutes` and `session_min_distance_km` from the weekly_goals query (line 277) and apply them when counting sessions:
```typescript
const { data: weeklyGoals } = await service
  .from("weekly_goals")
  .select("id, metric, is_recurring, session_min_duration_minutes, session_min_distance_km")
  ...
```

---

### HIGH

#### 1.6 Duplicate Token Refresh Logic
**Files:** `lib/strava.ts:19-67`, `app/api/sync-strava/route.ts:67-86 + 180-197`

Two independent implementations of Strava token refresh:
- `lib/strava.ts` — used by streams + laps endpoints
- `sync-strava/route.ts` — inline implementation with better error logging

Both have identical core logic (60s buffer, POST to Strava, update DB) but diverge in error handling. If refresh behavior needs to change (e.g., adding retry logic), it must be updated in two places.

**Fix:** Have `sync-strava/route.ts` call `getStravaAccessToken(userId)` from `lib/strava.ts` instead of implementing its own refresh.

---

#### 1.7 `bestRelevantRun` Helper Duplicated
**Files:** `components/screens/plan-screen.tsx:42-53`, task description mentions `goal-detail-screen.tsx`

The `bestRelevantRun()` function finding the fastest run at ±20% of target distance is defined identically in `plan-screen.tsx`. If a GoalDetailScreen is added later (the architecture document describes one), this would be duplicated again.

**Fix:** Move to `lib/format.ts` as a shared utility.

---

#### 1.8 Dark Mode Not Persisted (Lost on Refresh)
**File:** `components/app-shell.tsx:22, 177-179`

```typescript
const [isDarkMode, setIsDarkMode] = useState(false) // always starts false
useEffect(() => {
  document.documentElement.classList.toggle("dark", isDarkMode)
}, [isDarkMode])
```

The dark mode preference is pure React state with no persistence. On every page load, the app starts in light mode regardless of user preference. The `next-themes` package is installed in `package.json` (line 37) and a `ThemeProvider` component exists at `components/theme-provider.tsx`, but neither is used.

**Fix:** Wrap the app in `<ThemeProvider>` from `next-themes` which handles localStorage persistence, system preference detection, and flash prevention automatically. Remove the manual `isDarkMode` state and `useEffect`.

---

#### 1.9 Norwegian Hardcoded Strings in English App
**File:** `components/screens/goals-screen.tsx:67-73`

```typescript
if (weekStr === currentStr) return "Denne uken"  // Norwegian for "This week"
d.toLocaleDateString("nb-NO", { day: "numeric", month: "short" })  // Norwegian locale
```

The entire app is in English except this one function, which uses Norwegian text and date formatting. This is clearly a leftover from development.

**Fix:** Change to English:
```typescript
if (weekStr === currentStr) return "This week"
d.toLocaleDateString("en-US", { day: "numeric", month: "short" })
```

---

#### 1.10 Delete Operations Are Fire-and-Forget (No Error Handling)
**Files:** `components/app-shell.tsx:351-356, 456-461`

```typescript
const handleDeleteGoal = useCallback(async (goalId: string) => {
  setGoals((prev) => prev.filter((g) => g.id !== goalId))
  setIsEditorOpen(false)
  await supabase.from("goals").delete().eq("id", goalId)  // no error check
}, [])
```

If the database delete fails (network error, RLS violation), the item disappears from the UI but still exists in the DB. On next load, it reappears — confusing the user.

**Fix:** Add error handling with rollback:
```typescript
const handleDeleteGoal = useCallback(async (goalId: string) => {
  const snapshot = goals
  setGoals((prev) => prev.filter((g) => g.id !== goalId))
  setIsEditorOpen(false)
  const { error } = await supabase.from("goals").delete().eq("id", goalId)
  if (error) {
    console.error("Delete failed:", error)
    setGoals(snapshot) // rollback
  }
}, [goals])
```

---

#### 1.11 Supabase Client Created at Module Level (Outside Component)
**File:** `components/app-shell.tsx:17`

```typescript
const supabase = createClient()  // module-level, created once at import time
```

The Supabase browser client is created outside the component as a module-level singleton. While this works in practice (the browser client is designed to be reused), it means:
- The client is created immediately when the module is imported, even during SSR
- There's no way to reset the client on auth state changes without a page reload

This is a minor issue since `createBrowserClient` is designed for singleton use, but it should be documented as intentional.

---

#### 1.12 `select("*")` Fetches Unnecessary Columns
**File:** `components/app-shell.tsx:65-76`

All 6 initial queries use `select("*")`, fetching every column including potentially large ones like `map_polyline` (which can be thousands of characters for a running route). For 500+ activities, this adds significant payload.

**Fix:** Select only the fields used by the Activity interface:
```typescript
supabase.from("activities").select("id, type, name, date, distance_km, duration_seconds, pace_min_per_km, elevation_gain_m, avg_heart_rate, calories, strava_id")
```

---

### MEDIUM

#### 1.13 No Rate Limiting on Sync Endpoint
**File:** `app/api/sync-strava/route.ts`

The `POST /api/sync-strava` endpoint has no rate limiting. A user (or script) could spam this endpoint, which:
- Exhausts Strava's API quota (100 req/15 min, 1000/day)
- Creates concurrent sync operations that conflict
- Burns server resources on parallel Supabase queries

**Fix:** Add rate limiting via a simple timestamp check — reject syncs within 60 seconds of last sync:
```typescript
if (prevSync?.last_sync_at) {
  const lastSync = new Date(prevSync.last_sync_at).getTime()
  if (Date.now() - lastSync < 60_000) {
    return NextResponse.json({ error: "Please wait before syncing again" }, { status: 429 })
  }
}
```

---

#### 1.14 Goal Editor Generates Temp IDs That Could Leak Into State
**File:** `components/goal-editor.tsx:85`

```typescript
id: isNew ? `goal-${Date.now()}` : goal!.id,
```

When creating a new goal, a temporary ID like `goal-1709123456789` is generated. The `handleSaveGoal` in AppShell (line 274) checks `goals.find((g) => g.id === saved.id)` — since no goal has this temp ID, it correctly takes the insert path. But if the insert fails, the temp ID never enters state, which is correct. However, if two goals are created within the same millisecond (unlikely but possible), they'd share a temp ID.

**Fix:** Use `crypto.randomUUID()` instead of `Date.now()` for temp IDs.

---

#### 1.15 Timezone Inconsistency in Week Calculations
**Files:** `components/app-shell.tsx:189-194`, `lib/format.ts:145-149`, `components/screens/goals-screen.tsx:51-58`

Week boundaries are calculated differently across the codebase:
- AppShell: `new Date()` with `setHours(0,0,0,0)` (local midnight)
- format.ts `computeWeeklyProgress`: `new Date(weekStart).getTime()` (parsed as UTC if ISO string)
- goals-screen.tsx: `localMondayStr()` builds `YYYY-MM-DD` from local date parts

Activity dates from Strava are ISO/UTC strings (e.g., `2026-02-22T07:30:00Z`). If a user in UTC+12 runs at 10pm local time (which is 10am UTC the previous day), the activity could be counted in the wrong week depending on which calculation path is used.

**Fix:** Standardize all week boundary calculations to use a single timezone-aware function. The `date-fns` library (already installed) provides `startOfWeek` with timezone support.

---

#### 1.16 Mock Data File Is Completely Unused
**File:** `lib/mock-data.ts` (173 lines)

No file in the codebase imports from `lib/mock-data.ts` (confirmed via grep). This is dead code adding to bundle size.

**Fix:** Delete the file.

---

#### 1.17 Server Actions Exist But Are Partially Unused
**Files:** `lib/actions/goals.ts`, `lib/actions/activities.ts`, `lib/actions/sync.ts`, `lib/actions/weekly-goals.ts`, `lib/actions/profile.ts`

Server actions exist for CRUD operations on goals, but `AppShell` performs these operations directly via the Supabase browser client instead. The server actions are imported nowhere except `signOut` from `lib/actions/auth.ts`.

**Impact:** Two competing patterns for data mutation. The server actions have better type safety (using `mapRow()` with explicit field selection), while the AppShell approach has direct Supabase client calls with manual type casting.

**Fix:** Either commit to server actions (cleaner, better security) or remove the unused ones. Using server actions would also enable moving away from the browser client for mutations, reducing the attack surface.

---

#### 1.18 Login Page Uses `router.push` + `router.refresh` Instead of Server Action
**File:** `app/auth/login/page.tsx:30-31`

```typescript
router.push("/")
router.refresh()
```

The login page authenticates client-side, then uses client-side navigation. A server action (`app/auth/login/actions.ts`) exists but is unused. The `router.push("/")`/`router.refresh()` approach works but can cause a brief flash where the middleware hasn't yet picked up the new session cookie.

**Fix:** Use the existing `loginAction` server action, or keep the current approach but document why.

---

### LOW

#### 1.19 Chart Colors Hardcoded, Don't Adapt to Dark Mode
**File:** `components/screens/activity-detail-screen.tsx:195-199, 238-240, 281-283`

```typescript
stroke="#6366f1"  // indigo — hardcoded
fill="#6366f1"
```

Chart axis labels also use `fill: "#94a3b8"` (hardcoded gray) at lines 174, 186, 220, etc. These don't respond to the dark mode class toggle.

**Fix:** Use CSS custom properties: `stroke="var(--chart-1)"` and `fill="currentColor"` with a text utility class.

---

#### 1.20 `activeGoals` Computed Without `useMemo`
**File:** `components/app-shell.tsx:186`

```typescript
const activeGoals = goals.filter((g) => g.is_active)
```

This re-filters on every render. While filtering is cheap for small arrays, it's inconsistent with the `useMemo` pattern used for `weeklySummary` and `currentWeekGoals` directly below it.

**Fix:** Wrap in `useMemo`:
```typescript
const activeGoals = useMemo(() => goals.filter((g) => g.is_active), [goals])
```

---

#### 1.21 Activity Data Transformation Logic Is Duplicated
**Files:** `components/app-shell.tsx:91-108` and `components/app-shell.tsx:504-521`

The exact same field mapping (converting Supabase rows to Activity objects with `Number()` casts) appears in both the initial load and the post-sync refetch. Any change to the mapping must be applied in both places.

**Fix:** Extract to a `mapActivityRow()` utility function.

---

#### 1.22 No `key` Prop Warning Risk in Plan Screen Goal List
**File:** `components/screens/plan-screen.tsx:101`

The `sorted.map()` renders goal cards using `key={goal.id}`, which is correct. However, the sort happens on every render without memoization. If the sort order changes between renders (e.g., toggling a goal's active state), React may re-mount components unnecessarily.

**Fix:** Memoize the sorted list.

---

#### 1.23 `useTransition` Imported But Underutilized
**File:** `components/app-shell.tsx:46`

```typescript
const [, startTransition] = useTransition()
```

Only used for `handleSignOut`. All other async operations (save goal, delete, sync) could benefit from `startTransition` to keep the UI responsive during state updates.

---

#### 1.24 `formatElapsed` Duplicated in Activity Detail
**File:** `components/screens/activity-detail-screen.tsx:47-52`

This formatting function is defined locally but could be in `lib/format.ts` alongside the other formatting functions.

---

#### 1.25 `ActivityTypeBadge` Component Duplicated
**Files:** `components/screens/activities-screen.tsx:14-25`, `components/screens/activity-detail-screen.tsx:34-45`

Identical component defined in two files. Should be extracted to a shared component.

---

#### 1.26 `Strava_tokens` Table Missing `map_polyline` Column in Activities
**File:** `scripts/001_create_tables.sql:57-71`

The activities table schema doesn't include `map_polyline`, yet AppShell maps it from the Supabase response (line 105). This column may have been added via an untracked migration, or it silently returns `undefined`.

---

---

## 2. Improvements to Existing Logic & AI Logic

### Architecture Improvements

#### 2.1 Monolithic AppShell Component — SHOULD-HAVE
**File:** `components/app-shell.tsx` (645 lines, 15 useState, 15 useCallback, 3 useMemo)

Every state change in AppShell triggers a re-render of the entire app. A tab switch re-renders all 5 screens' worth of props computation, all goal/weekly-goal editor state, and all derived data.

**Recommended refactor:**
- Extract data fetching into a custom hook (`useAppData`) or use React Context
- Split editor state into a separate `EditorProvider` context
- Use `React.memo()` on screen components to prevent unnecessary re-renders
- Move navigation state to URL search params for browser history support

**Priority:** Should-have (significant perf and maintainability win)

---

#### 2.2 Zero SSR/RSC Utilization — SHOULD-HAVE
**File:** `app/page.tsx:1-4`

```typescript
import { AppShell } from "@/components/app-shell"
export default function Page() { return <AppShell /> }
```

The entire app is a single client component. There's zero server-side rendering:
- Initial HTML is an empty shell + spinner
- All data loads client-side after JS hydration
- No streaming, no Suspense boundaries
- SEO is non-existent (less relevant for a logged-in app, but still)

**Recommended approach:**
- Fetch initial data server-side in `app/page.tsx` using server components
- Pass data as props to `<AppShell>` for instant content on load
- Use Suspense boundaries for secondary data (streams, laps)
- Keep interactive parts as client components

**Priority:** Should-have (eliminates loading spinner, improves perceived performance)

---

#### 2.3 No Code Splitting or Lazy Loading — SHOULD-HAVE
**File:** `components/app-shell.tsx:1-12` (all screens imported statically)

All 6 screen components, Recharts (~200KB), both editors, and all UI components load upfront. Most users only view 1-2 screens per session.

**Fix:**
```typescript
const ActivityDetailScreen = lazy(() => import("@/components/screens/activity-detail-screen"))
const GoalsScreen = lazy(() => import("@/components/screens/goals-screen"))
// etc.
```

Wrap in `<Suspense fallback={<ScreenSkeleton />}>` per tab.

**Priority:** Should-have (Recharts alone is ~200KB gzipped)

---

#### 2.4 No Client-Side Navigation / URL Routing — NICE-TO-HAVE

The entire app uses React state for navigation (`activeTab`, `selectedActivity`). This means:
- Browser back button doesn't work
- No deep linking (can't share a link to a specific activity)
- No browser history
- Refreshing always returns to the Home tab

**Fix:** Use Next.js parallel routes or URL search params (`?tab=activities&id=123`).

**Priority:** Nice-to-have (but significantly improves UX for power users)

---

### AI/Claude Logic Improvements

> **Note:** The AI training plan system described in the architecture (Claude integration, `POST /api/ai/training-plan`, GoalDetailScreen with AI plan generation) does **not yet exist** in the codebase. The API routes, the `@anthropic-ai/sdk` dependency, and the GoalDetailScreen component are not present. The following improvements are therefore recommendations for when this system is built.

#### 2.5 AI Plan Implementation Design Recommendations — MUST-HAVE (for AI feature)

When implementing the AI training plan system:

**a) Streaming response:** Use Claude's streaming API to show plan sections as they generate, rather than making the user wait 5-10 seconds for a complete response.

**b) Response validation:** Parse and validate Claude's JSON response against a Zod schema before storing. If fields are missing or values are out of range, retry or fall back gracefully.

**c) Plan versioning:** Store plan history (not just the latest) so users can compare current vs previous plans. Use `generated_at` as the version key.

**d) Planned vs actual tracking:** After generating a plan, compare each week's planned sessions against actual activities. This feedback loop makes subsequent plan generations smarter.

**e) Rate limiting:** Add per-user rate limiting (e.g., max 5 plan generations per day) to prevent API cost spikes.

**f) Prompt injection protection:** Sanitize the `adjustNote` field before injecting into the Claude prompt. Strip or escape any instruction-like text.

**g) Extended thinking budget:** 5000 tokens of extended thinking may be overkill for structured JSON generation. Start with 2000 and measure quality.

**Priority:** Must-have (if building the AI feature)

---

### Strava Integration Improvements

#### 2.6 No Sync for Edited/Deleted Strava Activities — SHOULD-HAVE
**File:** `app/api/sync-strava/route.ts:199-207`

The sync uses `after` parameter for incremental fetches — only new activities since last sync. If a user edits an activity title or deletes an activity on Strava, the local copy is never updated.

**Fix:** Periodically do a full re-sync (e.g., every 7th sync), or add a "Full sync" button alongside the incremental one. For deletions, compare local strava_ids against Strava's list and soft-delete missing ones.

**Priority:** Should-have

---

#### 2.7 Only 4 Running Types Recognized — NICE-TO-HAVE
**File:** `app/api/sync-strava/route.ts:44`

```typescript
const RUNNING_SPORT_TYPES = new Set(["Run", "TrailRun", "VirtualRun", "Treadmill"])
```

Walking, hiking, and cycling activities are silently dropped. For a marathon trainer, walk breaks during long runs (tagged as "Walk" on Strava) would be missed.

**Fix:** Add "Walk" to the set, or allow user-configurable activity type inclusion.

**Priority:** Nice-to-have

---

#### 2.8 No Strava Webhook for Real-Time Sync — NICE-TO-HAVE
**Current:** Manual sync only (user presses button in Profile tab)

Strava supports webhook subscriptions that push new activities in real-time. This would eliminate the need for manual syncing.

**Implementation:**
- `POST /api/strava/webhook` — subscription validation + event handler
- On `activity.create` event, trigger sync for that specific activity
- Requires a publicly accessible URL (Vercel handles this)

**Priority:** Nice-to-have (significant UX improvement but adds complexity)

---

### Data & State Management Improvements

#### 2.9 Use `next-themes` Instead of Manual Dark Mode — MUST-HAVE
**Files:** `components/app-shell.tsx:22,177-183`, `components/theme-provider.tsx` (exists but unused)

The `next-themes` package is already installed and a ThemeProvider exists. Using it provides:
- localStorage persistence
- System preference detection (`prefers-color-scheme`)
- Flash prevention (SSR-compatible)
- Simpler API (`useTheme()` hook)

**Priority:** Must-have (5-minute fix, huge UX improvement)

---

#### 2.10 Optimize Activity Transformation with Shared Mapper — SHOULD-HAVE
**Files:** `components/app-shell.tsx:91-108, 504-521`

The Supabase-to-Activity mapping is duplicated. Create a shared mapper:
```typescript
function mapActivityRow(a: Record<string, unknown>): Activity {
  return {
    id: a.id as string,
    type: a.type as ActivityType,
    name: a.name as string,
    date: a.date as string,
    distance_km: Number(a.distance_km),
    duration_seconds: a.duration_seconds as number,
    pace_min_per_km: a.pace_min_per_km ? Number(a.pace_min_per_km) : null,
    elevation_gain_m: a.elevation_gain_m ? Number(a.elevation_gain_m) : null,
    avg_heart_rate: a.avg_heart_rate as number | null,
    calories: a.calories as number | null,
  }
}
```

**Priority:** Should-have

---

---

## 3. New Feature Ideas

### MUST-HAVE (Core training functionality gaps)

#### 3.1 Planned vs Actual Comparison
When the AI training plan is implemented, show a week-by-week comparison of planned volume/sessions vs what was actually run. This is the #1 feature serious runners expect from a training plan tool.

**Implementation:**
- After plan generation, create `planned_sessions` entries for each week
- On the Plan tab's week view, overlay planned targets with actual activities
- Show delta (e.g., "Planned: 45km | Actual: 38km | -15%")
- Feed delta data back into next plan generation for adaptive planning

---

#### 3.2 Session Completion Tracking
Let users mark individual planned sessions as done (or swap them). This bridges the gap between the AI plan and the activity log.

**Implementation:**
- Add `session_status` to each planned session (planned/completed/skipped/swapped)
- Auto-match completed activities to planned sessions by date + distance proximity
- Show completion rate per week

---

#### 3.3 Personal Records (PR) Detection
Auto-detect PRs for common distances (1km, 5km, 10km, half marathon, marathon) from activity history.

**Implementation:**
- Scan activities on sync for qualifying distances (±5%)
- Calculate pace-adjusted times for standard distances
- Store in a `personal_records` table
- Show PR badges on activities and a dedicated PR section in Profile

---

### SHOULD-HAVE (Significantly enhance the training experience)

#### 3.4 Route Map Visualization
The `map_polyline` field exists on activities (stored from Strava) but is never rendered. Show the running route on a map.

**Implementation:**
- Use a lightweight map library (Leaflet with OSM tiles, or Mapbox GL)
- Decode polyline and render on activity detail screen
- Lazy-load map component to avoid bundle bloat

---

#### 3.5 Heart Rate Zone Analysis
Break down time-in-zone from HR stream data. Essential for runners training by heart rate.

**Implementation:**
- Define 5 zones based on max HR (user-configurable or estimated from age)
- Calculate time spent in each zone from stream data
- Show as stacked bar chart on activity detail
- Aggregate zone distribution per week/month

---

#### 3.6 Pace Zone Analysis
Similar to HR zones but for pace. Show easy/tempo/threshold/interval distributions.

**Implementation:**
- Define pace zones relative to threshold pace
- Analyze pace stream data
- Useful for verifying training plan adherence (was that "easy" run actually easy?)

---

#### 3.7 Injury Risk Indicator (Acute:Chronic Workload Ratio)
Flag when training load spikes too quickly. The ACWR model compares 7-day load to 28-day average.

**Implementation:**
- Calculate rolling 7d and 28d load (distance or duration)
- ACWR = acute / chronic. Flag red when > 1.5
- Show as a warning banner on home screen when elevated
- Already have the data — just need the calculation and UI

---

#### 3.8 Training Load Graph (ATL/CTL/TSB)
Fitness/fatigue/form model using exponentially weighted moving averages. This is the gold standard for training load monitoring.

**Implementation:**
- CTL (Chronic Training Load, 42-day EMA) = fitness
- ATL (Acute Training Load, 7-day EMA) = fatigue
- TSB = CTL - ATL = form
- Plot as a line chart over time
- Show current form status (fresh/optimal/fatigued)

---

#### 3.9 Race Time Prediction
Estimate finish times for target distances based on training data. Use established models (Riegel formula, VDOT).

**Implementation:**
- Take best recent effort at a reference distance
- Apply Riegel formula: T2 = T1 × (D2/D1)^1.06
- Show predicted times for 5K, 10K, HM, Marathon
- Update prediction as training progresses

---

#### 3.10 Manual Activity Entry
Allow adding runs that weren't recorded on Strava (treadmill without a watch, forgot to start, etc.).

**Implementation:**
- Add "Log activity" button on Activities screen
- Simple form: date, distance, duration, type
- Store with `strava_id = null` to differentiate from synced activities

---

### NICE-TO-HAVE (Polish and delight features)

#### 3.11 Data Export (CSV/GPX)
Export activity history as CSV for spreadsheet analysis.

#### 3.12 Shoe/Gear Tracking
Track mileage on shoes/gear. Alert when approaching replacement threshold (500-800km for shoes).

#### 3.13 Weather Integration
Show weather conditions for past activities (fetched from weather API by date/location) and forecast for upcoming planned sessions.

#### 3.14 Weekly/Monthly Email Summaries
Scheduled summary of training progress. Can be implemented as a Supabase Edge Function on a cron schedule.

#### 3.15 Plan Sharing
Generate a shareable link for AI training plans. Useful for sharing with coaches or running partners.

#### 3.16 Offline PWA Support
The `manifest.json` exists but there's no service worker. Adding one would enable:
- Offline viewing of cached activities
- Background sync queue
- Push notifications for plan reminders

#### 3.17 Multi-Language Support
The Norwegian text in goals-screen.tsx suggests the developer is Norwegian. Add proper i18n for at least English and Norwegian.

---

---

## 4. Frontend UX & Performance Audit

### CRITICAL Performance Issues

#### 4.1 Entire App Is Client-Side Rendered
**File:** `app/page.tsx` → `components/app-shell.tsx`

**Problem:** The page loads as an empty shell, shows a spinner, then makes 6 parallel Supabase queries client-side before rendering any content. On slow connections, users see nothing for 2-5 seconds.

**Impact:** Poor First Contentful Paint (FCP), poor Largest Contentful Paint (LCP), poor Core Web Vitals.

**Fix:** Fetch initial data server-side in `app/page.tsx`:
```typescript
export default async function Page() {
  const supabase = await createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")

  const [activities, goals, ...] = await Promise.all([...])
  return <AppShell initialData={{ activities, goals, ... }} />
}
```

---

#### 4.2 Recharts Loaded Upfront (~200KB)
**File:** `components/screens/activity-detail-screen.tsx:6`

Recharts is imported statically and bundled into the main chunk. It's only used when viewing individual activity details — a secondary screen most users don't visit on every session.

**Fix:** Dynamic import:
```typescript
const ActivityDetailScreen = dynamic(
  () => import("@/components/screens/activity-detail-screen"),
  { loading: () => <DetailSkeleton /> }
)
```

---

#### 4.3 No Virtualization for Activity List
**File:** `components/screens/activities-screen.tsx:68-102`

All activities are rendered as DOM elements. A user with 500+ activities (common for serious runners) will have 500+ button elements in the DOM simultaneously, degrading scroll performance.

**Fix:** Use `@tanstack/react-virtual` or `react-window` for the activity list. Only render visible items + a small overscan buffer.

---

### HIGH UX Issues

#### 4.4 No Skeleton Screens / Loading States
**File:** `components/app-shell.tsx:539-547`

Only a centered spinner during initial load. No skeleton screens for:
- Activity list while loading
- Goal cards while loading
- Charts while fetching stream data
- Profile while loading

**Fix:** Add shimmer/skeleton components for each screen's layout. The shadcn/ui `Skeleton` component exists at `components/ui/skeleton.tsx`.

---

#### 4.5 No Toast/Notification System for Feedback
**Files:** `components/ui/toast.tsx`, `components/ui/toaster.tsx`, `hooks/use-toast.ts` (all exist but unused)

The toast infrastructure from shadcn/ui is fully installed but never used. All success/error feedback is either:
- `console.error()` (invisible to user)
- Inline state (only in sync status)
- Silent (delete operations)

**Fix:** Import `useToast` and add toast notifications for:
- Goal saved/deleted
- Sync complete/failed
- Network errors
- Form validation errors

---

#### 4.6 Dark Mode Doesn't Detect System Preference
**File:** `components/app-shell.tsx:22`

```typescript
const [isDarkMode, setIsDarkMode] = useState(false)
```

Always starts in light mode. Users with OS dark mode enabled see a flash of light before (if ever) toggling dark mode.

**Fix:** Use `next-themes` (already installed) which handles `prefers-color-scheme` automatically.

---

#### 4.7 App Maxed at `max-w-md` — Wasted Space on Tablets/Desktops
**File:** `components/app-shell.tsx:551`

```html
<div className="mx-auto min-h-dvh max-w-md bg-background">
```

`max-w-md` = 448px. On an iPad (768px+) or desktop, over half the screen is empty background.

**Fix:** Use responsive breakpoints:
```html
<div className="mx-auto min-h-dvh max-w-md md:max-w-2xl lg:max-w-4xl ...">
```
With a multi-column layout at wider breakpoints (sidebar navigation instead of bottom tabs on desktop).

---

#### 4.8 No Pull-to-Refresh on Mobile
Users expect pull-to-refresh for syncing activities. Currently they must navigate to Profile > Sync.

**Fix:** Add pull-to-refresh gesture on Activities and Home screens. Can be implemented with a touch event handler or a library like `react-pull-to-refresh`.

---

#### 4.9 Training Plan Generation Wait Time (No Streaming)
When the AI training plan feature is built, the 5-10 second generation time with only a skeleton loader will feel sluggish.

**Fix:** Use Claude's streaming API. Show the plan summary immediately, then stream in week details as they generate. This gives the user something to read within 1-2 seconds.

---

#### 4.10 "Due for Refresh" Badge Has No Action
The architecture describes a "Due for refresh" indicator on training plans that's purely informational.

**Fix:** Make it a tappable element that opens a "Regenerate plan?" confirmation.

---

### MEDIUM UX Issues

#### 4.11 Forms Don't Prevent Double-Submit
**Files:** `components/goal-editor.tsx:76-97`, `components/weekly-goal-editor.tsx:52-84`

The Save button has no loading state. Tapping "Save" multiple times during an async operation could create duplicate goals.

**Fix:** Add `isSaving` state, disable the button during save, show a spinner.

---

#### 4.12 Avatar Uses Raw `<img>` Instead of `next/image`
**File:** `components/screens/profile-screen.tsx:79-83`

```html
<img src={user.avatar_url} ... crossOrigin="anonymous" />
```

No lazy loading, no responsive sizing, no format optimization, no error fallback if the image fails to load.

**Fix:** Use `<Image>` with error handling:
```tsx
<Image src={user.avatar_url} alt={user.display_name} width={56} height={56} className="rounded-full" />
```

---

#### 4.13 No Keyboard Navigation for Tabs
**File:** `components/tab-bar.tsx`

The tab bar has proper ARIA attributes (`role="tab"`, `aria-selected`) but no keyboard event handlers. Arrow key navigation between tabs is expected for accessibility.

**Fix:** Add `onKeyDown` handler with left/right arrow support.

---

#### 4.14 Bottom Tab Bar Content Overlap Risk
**File:** `components/tab-bar.tsx:22-23`

```html
<nav className="fixed bottom-0 ..." style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
```

The tab bar uses `fixed` positioning with safe-area padding. Content uses `pb-20` (AppShell line 553). If `safe-area-inset-bottom` is large (e.g., iPhone with home indicator), the total tab bar height exceeds `pb-20` (80px), causing content to be hidden behind the tab bar.

**Fix:** Use a CSS variable for the tab bar height and set `pb-[var(--tab-bar-height)]` on the content.

---

#### 4.15 Carousel Performance — No Lazy Rendering
**File:** `components/screens/home-screen.tsx:86-152, 270-321, 339-366`

All carousel items are rendered immediately, even those off-screen. For the Recent Activities carousel with many items, this adds unnecessary DOM nodes.

**Fix:** Embla Carousel supports lazy rendering via its plugin system. Only render items within the viewport + 1 buffer.

---

### LOW UX Issues

#### 4.16 `backdrop-blur-xl` on Tab Bar Can Be Expensive on Mobile
**File:** `components/tab-bar.tsx:22`

`backdrop-blur-xl` triggers GPU compositing on every scroll frame. On older mobile devices, this can cause jank.

**Fix:** Test performance on low-end devices. If needed, reduce to `backdrop-blur-md` or use a solid background with slight transparency.

---

#### 4.17 No Haptic Feedback on Mobile Interactions
Touch interactions (tab switch, goal toggle, sync button) lack haptic feedback that native apps provide.

**Fix:** Use the Vibration API for key interactions:
```typescript
navigator.vibrate?.(10) // light tap feedback
```

---

#### 4.18 Date Inputs Use Browser Default Picker
**Files:** `components/goal-editor.tsx:280-284, 298-303`

The native `<input type="date">` varies widely across browsers. iOS Safari shows a spinner, Chrome shows a calendar. The styling also doesn't match the app's design language.

**Fix:** Use `react-day-picker` (already installed) with a custom styled calendar in a popover, matching the app's visual language.

---

#### 4.19 79 UI Components from shadcn/ui — Most Unused
**Directory:** `components/ui/` (79 files)

Only a handful of these are actually used (carousel, progress, skeleton, tabs, toast). The rest add to IDE noise and git history without providing value.

**Fix:** Remove unused UI components. They can always be re-added via `npx shadcn-ui add <component>`.

---

#### 4.20 Vercel Analytics Always Loaded
**File:** `app/layout.tsx:50`

```tsx
<Analytics />
```

The `@vercel/analytics` component is always rendered. The architecture mentions it should only load when `VERCEL=1`. The component itself is lightweight, but on non-Vercel deployments it adds unnecessary network requests.

**Fix:** Conditionally render:
```tsx
{process.env.VERCEL && <Analytics />}
```

---

---

## Summary Scorecard

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Flaws & Bugs | 5 | 6 | 5 | 10 | 26 |
| Improvements | — | 4 (should-have) | 3 (should-have) | 3 (nice-to-have) | 10 |
| New Features | — | 3 (must-have) | 7 (should-have) | 7 (nice-to-have) | 17 |
| UX/Performance | 3 (critical) | 7 (high) | 5 (medium) | 5 (low) | 20 |

### Top 10 Highest-Impact Actions (ordered by effort/impact ratio)

1. **Remove `ignoreBuildErrors: true`** — 5 min fix, prevents silent breakage
2. **Use `next-themes` for dark mode** — 10 min fix, persistence + system preference
3. **Fix Norwegian strings** — 2 min fix, obvious i18n bug
4. **Delete `lib/mock-data.ts`** — 1 min fix, dead code removal
5. **Fix Activity type interface** — 10 min fix, type safety for entire app
6. **Add toast notifications** — 30 min, dramatically better user feedback
7. **Server-side initial data fetch** — 2 hrs, eliminates loading spinner
8. **Lazy-load Recharts** — 15 min, ~200KB off initial bundle
9. **Consolidate token refresh logic** — 30 min, eliminates maintenance risk
10. **Add rate limiting to sync** — 15 min, prevents API quota exhaustion
