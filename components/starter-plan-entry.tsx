"use client";
import { useEffect, useState, type ComponentProps } from "react";
import { useStarterPlanCache, type StarterSnapshot } from "@/components/starter-plan-cache";
import { StarterWeekView } from "@/components/starter-week-view";
import { useI18n } from "@/lib/i18n";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Footprints, RotateCcw, Activity, Flag, Repeat, Sprout, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type {
  StarterProfile,
  StarterState,
} from "@/lib/starter-plan";

import type { SyncStatus } from "@/lib/types";

type Saved = { state: StarterState; version: number };
const initial: StarterProfile = {
  mode: "beginner",
  aim: "start",
  days: 2,
  continuousMinutes: 0,
  weeklyMinutes: 30,
  pauseWeeks: 12,
  estimatedFields: ["continuousMinutes", "weeklyMinutes", "pauseWeeks"],
  hasPain: false,
};
export function StarterPlanEntry({ offer = true, autoPrompt = false, syncFirst = false, stravaConnected = false, syncStatus, onConnectStrava, onSync, presentation = "entry", onOpenPlan, onExists }: { offer?: boolean; autoPrompt?: boolean; syncFirst?: boolean; stravaConnected?: boolean; syncStatus?: SyncStatus; onConnectStrava?: () => void; onSync?: () => void; presentation?: "entry" | "goal" | "page"; onOpenPlan?: () => void; onExists?: (exists: boolean) => void }) {
  const cache = useStarterPlanCache();
  const { locale } = useI18n();
  const no = locale === "no";
  const l = (nb: string, en: string) => (no ? nb : en);
  const [withoutStrava, setWithoutStrava] = useState(false);
  const showSyncChoice = syncFirst && !withoutStrava && (!stravaConnected || syncStatus?.state !== "success");
  const [saved, setSaved] = useState<Saved | null>(cache?.snapshot?.plan ?? null);
  const [loading, setLoading] = useState(cache?.snapshot === undefined);
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [open, setOpen] = useState(presentation === "page" && cache?.snapshot !== undefined && !cache.snapshot.plan);
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState(initial);
  const [error, setError] = useState("");
  function remember(data: StarterSnapshot) {
    setSaved(previous => (previous?.version ?? 0) > (data.plan?.version ?? 0) ? previous : data.plan);
    cache?.update(data);
  }
  async function load() {
    try {
      const res = await fetch("/api/starter-plan");
      if (!res.ok) throw new Error("load");
      const data = await res.json();
      remember(data);
      if (presentation === "page") setOpen(!data.plan);
    } catch {
      setError(
        l(
          "Kunne ikke hente startplanen. Prøv igjen.",
          "Could not load your starter plan. Try again.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let alive = true;
    fetch("/api/starter-plan")
      .then(async (res) => {
        if (!res.ok) throw new Error("load");
        const data = await res.json();
        if (alive) {
          remember(data);
          if (presentation === "page" && cache?.snapshot === undefined) setOpen(!data.plan);
          if (autoPrompt && offer && !saved && !data.plan && data.userId) {
            const key = `42195:starter-intro:${data.userId}`;
            let seen = false;
            try { seen = sessionStorage.getItem(key) === "seen"; sessionStorage.setItem(key, "seen"); } catch { /* Intro still works if browser storage is unavailable. */ }
            if (!seen) { setOpen(true); setStep(0); setSheetOpen(true); }
          }
        }
      })
      .catch(() => {
        if (alive)
          setError(
            l(
              "Kunne ikke hente startplanen. Prøv igjen.",
              "Could not load your starter plan. Try again.",
            ),
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [autoPrompt, offer, presentation]);
  const errors: Record<string, string> = {
    conflict: l(
      "Planen er endret på en annen enhet. Last inn på nytt før du fortsetter.",
      "Your plan changed on another device. Reload before continuing.",
    ),
    invalid_answers: l(
      "Sjekk svarene: oppgi treningstid og lengden på oppholdet der det er relevant.",
      "Check your answers: provide training time and break length where relevant.",
    ),
    week_not_finished: l(
      "Fullfør denne sjudagersperioden før du lager neste uke.",
      "Finish this seven-day period before creating the next week.",
    ),
    feedback_required: l(
      "Svar på hvordan hver økt gikk først.",
      "Tell us how each session went first.",
    ),
    pain_review: l(
      "Du har meldt om plager. Oppdater utgangspunktet før du planlegger videre; ikke øk treningen automatisk.",
      "You reported discomfort. Review your starting point before planning more; do not increase automatically.",
    ),
  };
  async function save(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/starter-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, version: saved?.version ?? 0 }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      remember(data);
      setOpen(false);
      if (body.action === "setup" && onOpenPlan) { setSheetOpen(false); onOpenPlan(); }
    } catch (e) {
      setError(
        errors[e instanceof Error ? e.message : ""] ??
          l(
            "Kunne ikke lagre. Ingen endringer er bekreftet. Prøv igjen.",
            "Could not save. No changes have been confirmed. Try again.",
          ),
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => { if (!loading) onExists?.(Boolean(saved)); }, [loading, saved, onExists]);
  if (loading) return presentation === "page" ? <p className="p-4 text-label">{l("Henter planen …", "Loading your plan …")}</p> : null;
  if (presentation === "goal" && !saved) return error ? <p role="alert" className="text-label">{error} <button className="underline" onClick={() => { setError(""); void load(); }}>{l("Prøv igjen", "Try again")}</button></p> : null;
  if (!offer && !saved && !error) return null;
  const answer = (key: "continuousMinutes" | "weeklyMinutes" | "pauseWeeks" | "days", value: number, estimated = false) => {
    setProfile(p => ({ ...p, [key]: value, estimatedFields: key === "days" ? p.estimatedFields : [...(p.estimatedFields ?? []).filter(k => k !== key), ...(estimated ? [key] : [])] as StarterProfile["estimatedFields"] }));
  };
  const choices = (label: string, key: "continuousMinutes" | "weeklyMinutes" | "pauseWeeks" | "days", options: { label: string; value: number; estimated?: boolean }[], min: number, max: number) => <fieldset className="flex flex-col gap-2">
    <legend className="mb-2 text-body font-semibold">{label}</legend>
    <div className="flex flex-wrap gap-2">{options.map(option => {
      const estimated = key !== "days" && profile.estimatedFields?.includes(key);
      const selected = profile[key] === option.value && Boolean(estimated) === Boolean(option.estimated);
      return <button key={option.label} type="button" aria-pressed={selected} onClick={() => answer(key, option.value, option.estimated)} className={`press min-h-11 rounded-lg border px-3 py-2 text-left text-label ${selected ? "border-primary bg-primary/10 text-primary" : "border-border"}`}>{option.label}</button>;
    })}</div>
    <details className="text-label text-muted-foreground"><summary className="press cursor-pointer py-2">{l("Jeg vil angi selv", "Enter my own estimate")}</summary><OptionalNumber label={label} value={profile[key]} min={min} max={max} onChange={value => answer(key, value)} /></details>
  </fieldset>;
  const next = saved?.state.week.sessions.find((s) => !s.feedback);
  const summary = !saved
    ? l("Kom i gang →", "Get started →")
    : saved.state.week.reason === "review"
      ? l("Se på utgangspunktet →", "Review your starting point →")
      : next
        ? `${l("Neste økt", "Next session")} · ${next.minutes} min · ${next.repeats ? l("Løp/gange", "Run/walk") : l("Rolig", "Easy")} →`
        : l("Oppsummer uken →", "Review your week →");
  return (
    <>
      {presentation !== "page" && <button
        className={presentation === "goal" ? "press flex w-full items-center justify-between gap-4 border-b border-border py-5 text-left" : "press w-fit py-2 text-left text-label font-semibold text-primary"}
        onClick={() => {
          if (saved && onOpenPlan) { onOpenPlan(); return; }
          setSheetOpen(true);
          if (!saved) {
            setOpen(true);
            setStep(0);
          }
        }}
      >
        {presentation === "goal" ? <><Footprints size={24} className="shrink-0 text-primary" aria-hidden /><span className="flex-1"><span className="block text-title font-semibold">{l("Kom i gang med løping", "Start running")}</span><span className="mt-1 block text-label text-muted-foreground">{l("Startplan", "Starter plan")} · {l("Etappe", "Stage")} {saved?.state.week.number}</span><span className="mt-1 block text-label text-primary">{summary}</span></span><ChevronRight size={20} aria-hidden /></> : saved && onOpenPlan ? <span><span className="block text-title font-semibold">{l("Kom i gang med løping", "Start running")}</span><span className="mt-1 block text-label">{summary}</span></span> : summary}
      </button>}
      {presentation !== "page" && !sheetOpen && error && (
        <p role="alert" className="text-label text-muted-foreground">
          {error}
        </p>
      )}
      <StarterSurface
        page={presentation === "page"}
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={
          open
            ? showSyncChoice ? l("Hent treningshistorikken din", "Bring in your training history") : l("Finn ditt utgangspunkt", "Find your starting point")
            : l("Startplan", "Starter plan")
        }
        closeLabel={l("Lukk", "Close")}
      >
        <div className="flex flex-col gap-4">
          {error && (
            <div role="alert">
              <p>{error}</p>
              <button
                className="mt-2 underline"
                onClick={() => {
                  setError("");
                  void load();
                }}
              >
                {l("Last inn på nytt", "Reload")}
              </button>
            </div>
          )}
          {open && showSyncChoice ? (
            <div className="flex flex-col gap-4">
              <p className="text-body">{l("Bruker du Strava? Vi kan hente historikken først, så du slipper å svare på det vi allerede vet.", "Use Strava? Bring in your history first so you do not have to answer what we already know.")}</p>
              {syncStatus?.state === "syncing" ? <p role="status" className="text-label">{l("Henter historikken din … Vi venter med kartleggingen til synkroniseringen er ferdig.", "Fetching your history … We will wait until syncing finishes before asking any questions.")}</p> : <>
                {stravaConnected && syncStatus?.state === "error" && <p role="alert" className="text-label">{l("Synkroniseringen lyktes ikke. Prøv igjen eller fortsett uten Strava.", "Sync did not finish successfully. Try again or continue without Strava.")}</p>}
                {stravaConnected && (syncStatus?.state === "partial" || syncStatus?.state === "rate_limited") && <p role="status" className="text-label">{syncStatus.state === "rate_limited" ? l("Strava har satt en midlertidig grense. Prøv igjen senere, eller fortsett med egne opplysninger.", "Strava has temporarily limited syncing. Retry later or continue with your own answers.") : l("Vi har ikke hentet hele historikken ennå. Fortsett synkroniseringen eller bruk egne opplysninger.", "Some history is still missing. Continue syncing or use your own answers.")}</p>}
                <Button onClick={() => stravaConnected ? onSync?.() : onConnectStrava?.()}>{stravaConnected ? l("Synkroniser Strava", "Sync Strava") : l("Koble til Strava", "Connect Strava")}</Button>
                <Button variant="ghost" onClick={() => { setWithoutStrava(true); setStep(0); }}>{l("Fortsett uten Strava", "Continue without Strava")}</Button>
              </>}
              <button className="press min-h-11 text-label text-muted-foreground" onClick={() => setSheetOpen(false)}>{l("Se deg rundt først", "Explore first")}</button>
            </div>
          ) : open ? (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (step < 2) setStep(step + 1);
                else void save({ action: "setup", profile });
              }}
            >
              <p className="text-micro text-muted-foreground">
                {l("Steg", "Step")} {step + 1}/3
              </p>
              {step === 0 && (
                <>
                  <fieldset className="flex flex-col gap-2"><legend className="mb-2 font-semibold">{l("Hva er utgangspunktet ditt?", "Where are you starting?")}</legend>
                    {([{ value: "beginner", icon: Sprout, label: l("Ny til løping", "New to running") }, { value: "experienced", icon: Activity, label: l("Trener allerede", "Already training") }, { value: "returning", icon: RotateCcw, label: l("Tilbake etter pause", "Returning after a break") }] as const).map(({ value, icon: Icon, label }) => <button key={value} type="button" aria-pressed={profile.mode === value} onClick={() => setProfile({ ...profile, mode: value })} className={`press flex min-h-14 items-center gap-3 rounded-lg border px-4 py-3 text-left ${profile.mode === value ? "border-primary bg-primary/10 text-primary" : "border-border"}`}><Icon size={23} aria-hidden />{label}</button>)}
                  </fieldset>
                  <fieldset className="flex flex-col gap-2"><legend className="mb-2 font-semibold">{l("Hva ønsker du å få til?", "What would you like to do?")}</legend>
                    {([{ value: "start", icon: Footprints, label: l("Komme i gang", "Get started") }, { value: "habit", icon: Repeat, label: l("Finne en rutine", "Build a habit") }, { value: "race", icon: Flag, label: l("Forberede et løp", "Prepare for a race") }] as const).map(({ value, icon: Icon, label }) => <button key={value} type="button" aria-pressed={profile.aim === value} onClick={() => setProfile({ ...profile, aim: value })} className={`press flex min-h-12 items-center gap-3 rounded-lg border px-4 py-3 text-left ${profile.aim === value ? "border-primary bg-primary/10 text-primary" : "border-border"}`}><Icon size={22} aria-hidden />{label}</button>)}
                  </fieldset>
                </>
              )}
              {step === 1 && (
                <>
                  <p className="text-label text-muted-foreground">{l("Et grovt anslag holder. Velg «Vet ikke» hvis du er usikker – du trenger ikke teste deg først.", "A rough estimate is enough. Choose ‘Not sure’ if you are unsure — no test needed.")}</p>
                  {choices(l("Hvor lenge føles rolig løping overkommelig nå?", "How long does easy running feel manageable now?"), "continuousMinutes", [
                    { label: l("Vet ikke · start med løp/gange", "Not sure · start with run/walk"), value: 0, estimated: true },
                    { label: l("Under 5 min", "Under 5 min"), value: 0 },
                    { label: "5–10 min", value: 5 }, { label: "10–20 min", value: 10 }, { label: "20–30 min", value: 20 }, { label: "30+ min", value: 30 },
                  ], 0, 180)}
                  {profile.mode !== "beginner" && choices(profile.mode === "returning" ? l("Hvordan pleide du å løpe?", "What was your running routine?") : l("Hvordan løper du vanligvis?", "What is your usual running routine?"), "weeklyMinutes", [
                    { label: l("Vet ikke · start forsiktig", "Not sure · start gently"), value: 30, estimated: true },
                    { label: l("En kort tur i uken", "One short run a week"), value: 30 },
                    { label: l("Et par halvtimesturer", "A couple of half-hour runs"), value: 60 },
                    { label: l("Rundt 2 timer i uken", "Around 2 hours a week"), value: 120 },
                    { label: l("3 timer eller mer", "3 hours or more"), value: 180 },
                  ], 10, 1200)}
                  {profile.mode === "returning" && choices(l("Omtrent hvor lenge har du hatt opphold?", "Roughly how long was your break?"), "pauseWeeks", [
                    { label: l("Vet ikke", "Not sure"), value: 12, estimated: true },
                    { label: l("Noen uker", "A few weeks"), value: 3 },
                    { label: l("1–3 måneder", "1–3 months"), value: 12 },
                    { label: l("3–6 måneder", "3–6 months"), value: 26 },
                    { label: l("Over et halvt år", "Over half a year"), value: 52 },
                  ], 1, 104)}
                  <p className="text-micro text-muted-foreground">{l("Ved «Vet ikke» bruker vi et forsiktig startanslag, ikke en vurdering av formen din. Planen justeres etter hvordan øktene oppleves.", "‘Not sure’ uses a gentle starting assumption, not an assessment of your fitness. The plan adapts to how sessions feel.")}</p>
                </>
              )}
              {step === 2 && (
                <>
                  {choices(l("Hvor mange dager passer i hverdagen din?", "How many days fit your routine?"), "days", [1,2,3,4,5].map(value => ({ value, label: value === 2 ? l("2 dager · foreslått start", "2 days · suggested start") : l(`${value} dager`, `${value} days`) })), 1, 5)}
                  <label className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={profile.hasPain}
                      onChange={(e) =>
                        setProfile({ ...profile, hasPain: e.target.checked })
                      }
                    />
                    {l(
                      "Jeg har smerter eller plager som påvirker løping",
                      "I have pain or discomfort affecting running",
                    )}
                  </label>
                  <p className="text-label text-muted-foreground">
                    {l(
                      "Dette blir en foreløpig uke basert på egne opplysninger. Ingen fartsmål eller løpsprognoser. Du kan gå underveis og stoppe tidligere.",
                      "This is a provisional week based on your answers. No pace targets or race predictions. You can walk or stop earlier.",
                    )}
                  </p>
                </>
              )}
              <div className="flex flex-wrap gap-2">
                {step > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setStep(step - 1)}
                  >
                    {l("Tilbake", "Back")}
                  </Button>
                )}
                <Button type="submit" disabled={busy}>
                  {step < 2
                    ? l("Neste", "Next")
                    : busy
                      ? l("Lagrer …", "Saving …")
                      : l("Lag startplan", "Create starter plan")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setOpen(false);
                    setSheetOpen(false);
                  }}
                >
                  {saved ? l("Avbryt", "Cancel") : l("Se deg rundt først", "Explore first")}
                </Button>
              </div>
            </form>
          ) : saved ? (
            <StarterWeekView state={saved.state} busy={busy} save={save} onEdit={() => { setProfile(saved.state.profile); setStep(0); setOpen(true); }} />
          ) : null}
        </div>
      </StarterSurface>
    </>
  );
}


function OptionalNumber({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  return <label className="flex flex-col gap-1">{label}<input required type="number" inputMode="numeric" min={min} max={max} value={text} className="rounded-md border bg-background p-3" onChange={event => {
    const next = event.target.value;
    setText(next);
    if (next !== "" && event.target.validity.valid) onChange(Number(next));
  }} /></label>;
}


function StarterSurface({ page, ...props }: ComponentProps<typeof BottomSheet> & { page: boolean }) {
  if (page) return <section className="px-4 pb-8 pt-2" aria-label={props.title}>{props.children}</section>;
  return <BottomSheet {...props} />;
}
