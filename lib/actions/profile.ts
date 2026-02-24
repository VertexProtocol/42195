"use server"

import { createClient } from "@/lib/supabase/server"
import type { UserProfile } from "@/lib/types"

export async function getProfile(userId: string): Promise<UserProfile | null> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from("profiles")
    .select("id, display_name, email, avatar_url")
    .eq("id", userId)
    .single()

  if (error) {
    if (error.code === "PGRST116") return null // row not found
    throw error
  }

  return {
    id: data.id,
    display_name: data.display_name ?? "",
    email: data.email ?? "",
    avatar_url: data.avatar_url ?? null,
  }
}

export async function updateProfile(
  userId: string,
  data: Partial<{ display_name: string; avatar_url: string | null }>,
): Promise<UserProfile> {
  const supabase = await createClient()

  const { data: row, error } = await supabase
    .from("profiles")
    .update(data)
    .eq("id", userId)
    .select("id, display_name, email, avatar_url")
    .single()

  if (error) throw error

  return {
    id: row.id,
    display_name: row.display_name ?? "",
    email: row.email ?? "",
    avatar_url: row.avatar_url ?? null,
  }
}
