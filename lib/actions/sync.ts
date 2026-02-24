"use server"

import { createClient } from "@/lib/supabase/server"
import type { SyncStatus } from "@/lib/types"

export async function getSyncStatus(userId: string): Promise<SyncStatus | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("sync_status")
    .select("last_sync_at, state, error_message")
    .eq("user_id", userId)
    .single()

  if (error) {
    if (error.code === "PGRST116") return null // row not found
    throw error
  }

  return {
    last_sync_at: data.last_sync_at,
    state: data.state as SyncStatus["state"],
    error_message: data.error_message,
  }
}

export async function upsertSyncStatus(
  userId: string,
  data: {
    state: SyncStatus["state"]
    last_sync_at?: string | null
    error_message?: string | null
  },
): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase.from("sync_status").upsert(
    {
      user_id: userId,
      state: data.state,
      last_sync_at: data.last_sync_at ?? null,
      error_message: data.error_message ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  )

  if (error) throw error
}
