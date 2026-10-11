"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Button } from "@/components/ui/button";
import type {
  StarterFeedback,
  StarterProfile,
  StarterState,
} from "@/lib/starter-plan";

type Saved = { state: StarterState; version: number };
const initial: StarterProfile = {
  mode: "beginner",
  aim: "start",
  days: 2,
  continuousMinutes: 0,
  weeklyMinutes: 0,
  pauseWeeks: 1,
  hasPain: false,
};
export function StarterPlanEntry({ offer = true, autoPrompt = false }: { offer?: boolean; autoPrompt?: boolean }) {
  const { locale } = useI18n();
  const no = locale === "no";
  const l = (nb: string, en: string) => (no ? nb : en);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState(initial);
  const [error, setError] = useState("");
  async function load() {
    try {
      const res = await fetch("/api/starter-plan");
      if (!res.ok) throw new Error("load");
      const data = await res.json();
      setSaved(data.plan);
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
          setSaved(data.plan);
          if (autoPrompt && offer && !data.plan && data.userId) {
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
  }, [autoPrompt, offer]);
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
      setSaved(data.plan);
      setOpen(false);
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
  if (loading) return null;
  if (!offer && !saved && !error) return null;
  const field = (
    label: string,
    key: "continuousMinutes" | "weeklyMinutes" | "pauseWeeks" | "days",
    min: number,
    max: number,
  ) => (
    <label className="flex flex-col gap-1 text-label">
      {label}
      <input
        className="rounded-md border bg-background p-3"
        type="number"
        min={min}
        max={max}
        required
        value={profile[key]}
        onChange={(e) =>
          setProfile({
            ...profile,
            [key]: e.target.value === "" ? 0 : Number(e.target.value),
          })
        }
      />
    </label>
  );
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
      <button
        className="press w-fit py-2 text-left text-label font-semibold text-primary"
        onClick={() => {
          setSheetOpen(true);
          if (!saved) {
            setOpen(true);
            setStep(0);
          }
        }}
      >
        {summary}
      </button>
      {!sheetOpen && error && (
        <p role="alert" className="text-label text-muted-foreground">
          {error}
        </p>
      )}
      <BottomSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        title={
          open
            ? l("Finn ditt utgangspunkt", "Find your starting point")
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
          {open ? (
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
                  <label className="flex flex-col gap-2">
                    {l(
                      "Hva er utgangspunktet ditt?",
                      "Where are you starting?",
                    )}
                    <select
                      className="rounded-md border bg-background p-3"
                      value={profile.mode}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          mode: e.target.value as StarterProfile["mode"],
                        })
                      }
                    >
                      <option value="beginner">
                        {l("Jeg er ny til løping", "I am new to running")}
                      </option>
                      <option value="experienced">
                        {l(
                          "Jeg trener, men historikken er ikke her",
                          "I train, but my history is not here",
                        )}
                      </option>
                      <option value="returning">
                        {l(
                          "Jeg kommer tilbake etter et opphold",
                          "I am returning after a break",
                        )}
                      </option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-2">
                    {l("Hva ønsker du å få til?", "What would you like to do?")}
                    <select
                      className="rounded-md border bg-background p-3"
                      value={profile.aim}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          aim: e.target.value as StarterProfile["aim"],
                        })
                      }
                    >
                      <option value="start">
                        {l("Komme i gang", "Get started")}
                      </option>
                      <option value="habit">
                        {l("Trene jevnlig", "Build a habit")}
                      </option>
                      <option value="race">
                        {l(
                          "Etter hvert forberede et løp",
                          "Eventually prepare for a race",
                        )}
                      </option>
                    </select>
                  </label>
                </>
              )}
              {step === 1 && (
                <>
                  {field(
                    l(
                      "Hvor mange minutter kan du løpe rolig sammenhengende nå? (0 er helt greit)",
                      "How many minutes can you run easily without stopping now? (0 is fine)",
                    ),
                    "continuousMinutes",
                    0,
                    180,
                  )}
                  {profile.mode !== "beginner" &&
                    field(
                      profile.mode === "returning"
                        ? l(
                            "Vanlig løping før oppholdet – minutter per uke",
                            "Usual running before the break – minutes per week",
                          )
                        : l(
                            "Omtrentlige løpeminutter per uke nå",
                            "Approximate running minutes per week now",
                          ),
                      "weeklyMinutes",
                      10,
                      1200,
                    )}
                  {profile.mode === "returning" &&
                    field(
                      l(
                        "Hvor mange uker har oppholdet vart?",
                        "How many weeks has the break lasted?",
                      ),
                      "pauseWeeks",
                      1,
                      104,
                    )}
                </>
              )}
              {step === 2 && (
                <>
                  {field(
                    l(
                      "Hvor mange dager i uken passer det å trene?",
                      "How many days per week fit your schedule?",
                    ),
                    "days",
                    1,
                    5,
                  )}
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
            <>
              <p className="text-micro text-muted-foreground">
                {l(
                  "Foreløpig · Selvrapportert grunnlag · Uke",
                  "Provisional · Self-reported baseline · Week",
                )}{" "}
                {saved.state.week.number}
              </p>
              <p className="text-label">
                {
                  {
                    initial: l(
                      "Første uke handler om å finne en rytme som passer.",
                      "The first week is about finding a manageable routine.",
                    ),
                    repeat: l(
                      "Vi beholder nivået. Tidsmangel tolkes ikke som dårligere form.",
                      "We keep the level. Lack of time is not treated as reduced fitness.",
                    ),
                    easier: l(
                      "Du opplevde øktene som krevende. Denne uken er lettere.",
                      "You found sessions hard. This week is easier.",
                    ),
                    progress: l(
                      "To uker opplevdes lette. Vi prøver en liten økning i tid.",
                      "Two weeks felt easy. We try a small increase in time.",
                    ),
                    review: l(
                      "Vi setter løpeøktene på vent mens plagene avklares. Ikke press gjennom smerte; avklar med helsepersonell ved behov.",
                      "Running sessions are paused while discomfort is clarified. Do not push through pain; consult a clinician when needed.",
                    ),
                  }[saved.state.week.reason]
                }
              </p>
              {saved.state.profile.aim === "race" && (
                <p className="text-label text-muted-foreground">
                  {l(
                    "Startuken bygger en rutine. Den er ikke en plan for å rekke en bestemt løpsdato.",
                    "This starter week builds a routine. It is not a plan for a specific race deadline.",
                  )}
                </p>
              )}
              <p className="text-title font-semibold">{l("Din første sti", "Your starting path")} · {l("Etappe", "Stage")} {saved.state.week.number}</p>
              <p className="text-label text-muted-foreground">{l("Hvile mellom stoppene er en del av reisen.", "Rest between stops is part of the journey.")}</p>
              <ol className="ml-3 flex flex-col border-l-2 border-border">
                {saved.state.week.sessions.map((session, i) => (
                  <li key={session.id} className="relative flex flex-col gap-2 py-4 pl-7">
                    <span aria-hidden className={`absolute -left-3 top-4 flex size-6 items-center justify-center rounded-full border-4 border-background ${session.feedback && ["easy", "ok", "hard"].includes(session.feedback) ? "bg-success text-success-foreground" : "bg-muted text-muted-foreground"}`}>{session.feedback && ["easy", "ok", "hard"].includes(session.feedback) ? "✓" : "·"}</span>
                    {!session.feedback && saved.state.week.reason !== "review" && i === saved.state.week.sessions.findIndex(s => !s.feedback) && <p className="text-micro font-semibold text-primary">{l("Neste steg", "Next step")}</p>}
                    <h3 className="font-semibold">
                      {l("Økt", "Session")} {i + 1} · {session.minutes} min ·{" "}
                      {new Date(
                        +new Date(saved.state.week.startsAt) +
                          session.dayOffset * 86400000,
                      ).toLocaleDateString(no ? "nb-NO" : "en-GB", {
                        day: "numeric",
                        month: "short",
                      })}
                    </h3>
                    <p className="text-label">
                      {saved.state.week.reason === "review" && !session.feedback
                        ? l(
                            "Satt på vent. Oppdater utgangspunktet før du fortsetter å løpe.",
                            "Paused. Review your starting point before continuing to run.",
                          )
                        : session.repeats
                          ? l(
                              `5 min gange. Gjenta ${session.repeats} ganger: 1 min rolig løping + 90 sek gange. Avslutt med 5 min gange.`,
                              `Walk 5 min. Repeat ${session.repeats} times: 1 min easy running + 90 sec walking. Finish with 5 min walking.`,
                            )
                          : l(
                              "Rolig innsats hvor du kan prate. Start og avslutt rolig; gå ved behov.",
                              "Easy conversational effort. Start and finish gently; walk as needed.",
                            )}
                    </p>
                    <label className="flex flex-col gap-1 text-label">
                      {l("Hvordan gikk økten?", "How did it go?")}
                      <select
                        className="rounded-md border bg-background p-2"
                        disabled={busy}
                        value={session.feedback ?? ""}
                        onChange={(e) =>
                          void save({
                            action: "feedback",
                            sessionId: session.id,
                            feedback: e.target.value as StarterFeedback,
                          })
                        }
                      >
                        <option value="" disabled>
                          {l("Ikke svart ennå", "Not answered yet")}
                        </option>
                        {(["easy", "ok", "hard", "time", "pain"] as const).map(
                          (v, j) => (
                            <option key={v} value={v}>
                              {
                                (no
                                  ? [
                                      "Gjennomført – lett",
                                      "Gjennomført – passe",
                                      "Gjennomført – for krevende",
                                      "Ikke gjennomført – tidsmangel",
                                      "Plager / smerte",
                                    ]
                                  : [
                                      "Completed – easy",
                                      "Completed – manageable",
                                      "Completed – too hard",
                                      "Missed – lack of time",
                                      "Discomfort / pain",
                                    ])[j]
                              }
                            </option>
                          ),
                        )}
                      </select>
                    </label>
                  </li>
                ))}
              </ol>
              <p className="text-micro text-muted-foreground">
                {l(
                  "Tilbakemeldingene brukes til neste uke og oppretter ikke målte aktiviteter. Du kan flytte øktene; ha hviledager mellom løp/gange-øktene.",
                  "Feedback informs next week and does not create measured activities. Move sessions as needed; keep rest days between run/walk sessions.",
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy || !saved.state.week.sessions.length}
                  onClick={() => void save({ action: "next" })}
                >
                  {l("Planlegg neste uke", "Plan next week")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setProfile(saved.state.profile);
                    setStep(0);
                    setOpen(true);
                  }}
                >
                  {l("Oppdater utgangspunkt", "Update starting point")}
                </Button>
              </div>
            </>
          ) : null}
        </div>
      </BottomSheet>
    </>
  );
}
