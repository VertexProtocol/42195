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
    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe(
      "0",
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Create starter plan" }),
    );
    await screen.findByText(/Provisional · Self-reported/);
    expect(screen.getAllByText(/Walk 5 min/)).toHaveLength(2);
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
    await screen.findByText(/Provisional · Self-reported/);
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
