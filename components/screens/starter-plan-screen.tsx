"use client"
import { AppBar } from "@/components/app-bar"
import { StarterPlanEntry } from "@/components/starter-plan-entry"
import { useI18n } from "@/lib/i18n"
export function StarterPlanScreen({ onBack }: { onBack: () => void }) {
  const { locale } = useI18n()
  return <><AppBar title={locale === "no" ? "Kom i gang med løping" : "Start running"} onBack={onBack} /><StarterPlanEntry presentation="page" /></>
}
