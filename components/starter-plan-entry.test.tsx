// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { StarterPlanEntry } from "./starter-plan-entry";
import { createStarterPlan } from "@/lib/starter-plan";
afterEach(() => { vi.unstubAllGlobals(); sessionStorage.clear(); });
describe("starter onboarding", () => {
  it("automatically introduces new users once per browser session without a dashboard card", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ok:true,json:async()=>({plan:null,userId:"new-runner"})})));
    const view=render(<I18nProvider><StarterPlanEntry autoPrompt /></I18nProvider>);
    expect(await screen.findByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByRole("button",{name:"Explore first"}));
    await waitFor(()=>expect(screen.queryByRole("dialog")).toBeNull());
    view.unmount();
    render(<I18nProvider><StarterPlanEntry autoPrompt /></I18nProvider>);
    await screen.findByRole("button",{name:"Get started →"});
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("creates and reloads a beginner plan without Strava or a race", async () => {
    let plan: any = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options) => {
        if (options?.method === "POST") {
          const body = JSON.parse(options.body);
          plan = { state: createStarterPlan(body.profile), version: 1 };
        }
        return { ok: true, json: async () => ({ plan }) };
      }),
    );
    const view = render(
      <I18nProvider>
        <StarterPlanEntry />
      </I18nProvider>,
    );
    const start = await screen.findByRole("button", { name: "Get started →" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(start.closest(".surface")).toBeNull();
    fireEvent.click(start);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("button", { name: "Not sure · start with run/walk" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Create starter plan" }),
    );
    await screen.findByText(/Week 1 ·/);
    expect(screen.queryByText(/Walk 5 min/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Session 1 ·/ }));
    expect(screen.getByText(/Walk 5 min/)).toBeTruthy();
    expect(plan.state.profile.mode).toBe("beginner");
    view.unmount();
    render(
      <I18nProvider>
        <StarterPlanEntry />
      </I18nProvider>,
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /Next session/ }),
    );
    await screen.findByText(/Week 1 ·/);
    expect(screen.queryByRole("button", { name: "Get started →" })).toBeNull();
  });
  it("keeps the form and shows a failure when saving fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options) => ({
        ok: !options?.method,
        json: async () =>
          options?.method ? { error: "save_failed" } : { plan: null },
      })),
    );
    render(
      <I18nProvider>
        <StarterPlanEntry />
      </I18nProvider>,
    );
    const start = await screen.findByRole("button", { name: "Get started →" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(start.closest(".surface")).toBeNull();
    fireEvent.click(start);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Create starter plan" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("Could not save"),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Create starter plan",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
});


it("lets users erase and replace their own estimate", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ plan: null }) })));
  render(<I18nProvider><StarterPlanEntry /></I18nProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Get started →" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByText("Enter my own estimate"));
  const input = screen.getByRole("spinbutton") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "" } });
  expect(input.value).toBe("");
  expect(input.checkValidity()).toBe(false);
  fireEvent.change(input, { target: { value: "15" } });
  expect(input.value).toBe("15");
  expect(input.checkValidity()).toBe(true);
});

it("creates a returning runner plan without requiring remembered numbers", async () => {
  let submitted: any;
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    if (options?.method === "POST") { submitted = JSON.parse(options.body).profile; return { ok: true, json: async () => ({ plan: { state: createStarterPlan(submitted), version: 1 } }) }; }
    return { ok: true, json: async () => ({ plan: null }) };
  }));
  render(<I18nProvider><StarterPlanEntry /></I18nProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Get started →" }));
  fireEvent.click(screen.getByRole("button", { name: "Returning after a break" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByRole("button", { name: "Not sure · start gently" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Create starter plan" }));
  await screen.findByText(/Week 1 ·/);
  expect(submitted.estimatedFields).toEqual(["continuousMinutes", "weeklyMinutes", "pauseWeeks"]);
  expect(submitted.mode).toBe("returning");
});

it("offers Strava before assessment and allows an explicit opt-out", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ plan: null, userId: "strava-choice" }) })));
  const connect = vi.fn();
  render(<I18nProvider><StarterPlanEntry autoPrompt syncFirst onConnectStrava={connect} /></I18nProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Connect Strava" }));
  expect(connect).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Continue without Strava" }));
  expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
});

it("waits for syncing to finish before asking questions", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ plan: null, userId: "sync-wait" }) })));
  const props = { autoPrompt: true, syncFirst: true, stravaConnected: true };
  const view = render(<I18nProvider><StarterPlanEntry {...props} syncStatus={{ state: "syncing", last_sync_at: null, error_message: null }} /></I18nProvider>);
  await screen.findByRole("dialog");
  expect(screen.getByRole("status").textContent).toContain("Fetching your history");
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  view.rerender(<I18nProvider><StarterPlanEntry {...props} syncStatus={{ state: "success", last_sync_at: new Date().toISOString(), error_message: null }} /></I18nProvider>);
  expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
});

it.each(["error", "partial", "rate_limited"] as const)("does not treat %s as complete history", async state => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ plan: null, userId: `sync-${state}` }) })));
  const retry = vi.fn();
  render(<I18nProvider><StarterPlanEntry autoPrompt syncFirst stravaConnected onSync={retry} syncStatus={{ state, last_sync_at: null, error_message: null }} /></I18nProvider>);
  fireEvent.click(await screen.findByRole("button", { name: "Sync Strava" }));
  expect(retry).toHaveBeenCalledOnce();
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  expect(screen.getByRole("button", { name: "Continue without Strava" })).toBeTruthy();
});

it("closes the onboarding when imported history is sufficient", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ plan: null, userId: "enough-history" }) })));
  const view = render(<I18nProvider><StarterPlanEntry autoPrompt syncFirst stravaConnected syncStatus={{ state: "syncing", last_sync_at: null, error_message: null }} /></I18nProvider>);
  await screen.findByRole("dialog");
  view.rerender(<I18nProvider><StarterPlanEntry offer={false} syncFirst stravaConnected syncStatus={{ state: "success", last_sync_at: new Date().toISOString(), error_message: null }} /></I18nProvider>);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
});


it("opens a saved starter plan as a goal and shows it on its own page", async () => {
  const plan = { state: createStarterPlan({ mode: "beginner", aim: "start", days: 2, continuousMinutes: 0, weeklyMinutes: 0, pauseWeeks: 0, hasPain: false }), version: 1 };
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ plan }) })));
  const open = vi.fn();
  const view = render(<I18nProvider><StarterPlanEntry presentation="goal" offer={false} onOpenPlan={open} /></I18nProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /Start running/ }));
  expect(open).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog")).toBeNull();
  view.unmount();
  render(<I18nProvider><StarterPlanEntry presentation="page" /></I18nProvider>);
  await screen.findByText(/Week 1 ·/);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("combobox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Session 1 ·/ }));
  expect(screen.getAllByRole("button", { name: "Easy" })).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: "Felt pain" })).toHaveLength(1);
});

it("persists icon feedback and reflects only confirmed answers", async () => {
  let plan = { state: createStarterPlan({ mode: "beginner", aim: "start", days: 2, continuousMinutes: 0, weeklyMinutes: 0, pauseWeeks: 0, hasPain: false }), version: 1 };
  let payload: any;
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    if (options?.method === "POST") {
      payload = JSON.parse(options.body);
      plan = { ...plan, version: 2, state: { ...plan.state, week: { ...plan.state.week, sessions: plan.state.week.sessions.map(s => s.id === payload.sessionId ? { ...s, feedback: payload.feedback } : s) } } };
    }
    return { ok: true, json: async () => ({ plan }) };
  }));
  render(<I18nProvider><StarterPlanEntry presentation="page" /></I18nProvider>);
  fireEvent.click(await screen.findByRole("button", { name: /Session 1 ·/ }));
  fireEvent.click(screen.getByRole("button", { name: "Manageable" }));
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Manageable" })[0].getAttribute("aria-pressed")).toBe("true"));
  expect(payload.feedback).toBe("ok");
  expect(payload.version).toBe(1);
});
