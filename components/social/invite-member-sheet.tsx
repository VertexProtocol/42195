"use client"

import { useState } from "react"
import { X, UserPlus, AtSign } from "lucide-react"
import { useI18n } from "@/lib/i18n"

interface Props {
  sharedGoalId: string
  onClose: () => void
  onInvited: () => void
}

export function InviteMemberSheet({ sharedGoalId, onClose, onInvited }: Props) {
  const { t } = useI18n()
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const submit = async () => {
    const q = query.trim()
    if (!q) return
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch(`/api/goal-shares/${sharedGoalId}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? `Status ${res.status}`)
      setSuccess(`${t("shared.inviteSent")}: ${body.invited_user?.display_name ?? q}`)
      setQuery("")
      setTimeout(onInvited, 900)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-foreground/30" onClick={onClose} aria-hidden="true" />
      <div
        className="fixed inset-x-0 bottom-0 z-[70] mx-auto max-w-md animate-in slide-in-from-bottom duration-300"
        role="dialog"
        aria-modal="true"
        aria-labelledby="invite-sheet-title"
      >
        <div className="flex max-h-[92dvh] flex-col rounded-t-3xl bg-card shadow-2xl ring-1 ring-border">
          <div className="flex shrink-0 justify-center pt-3 pb-1">
            <div className="h-1 w-10 rounded-full bg-border" />
          </div>
          <div className="flex shrink-0 items-center justify-between px-5 pb-3 pt-2">
            <button
              onClick={onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary active:bg-accent"
              aria-label={t("shared.close")}
            >
              <X size={18} className="text-muted-foreground" />
            </button>
            <h2 id="invite-sheet-title" className="text-base font-semibold">{t("shared.inviteMember")}</h2>
            <div className="w-9" />
          </div>

          <div className="flex flex-col gap-4 px-5 pb-6 pt-2">
            <p className="text-sm text-muted-foreground">{t("shared.inviteDescription")}</p>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="invite-query" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t("shared.emailOrName")}
              </label>
              <div className="relative">
                <AtSign size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="invite-query"
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("shared.invitePlaceholder")}
                  className="h-12 w-full rounded-xl border-0 bg-secondary pl-10 pr-4 text-base text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/40"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !busy) submit()
                  }}
                />
              </div>
            </div>

            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}
            {success && (
              <p className="rounded-lg bg-success/10 px-3 py-2 text-xs text-success">
                {success}
              </p>
            )}

            <button
              onClick={submit}
              disabled={busy || !query.trim()}
              className="mt-2 flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground active:opacity-80 disabled:opacity-40"
            >
              <UserPlus size={16} />
              {busy ? t("shared.sending") : t("shared.sendInvite")}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
