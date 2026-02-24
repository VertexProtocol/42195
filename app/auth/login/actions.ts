"use server"

import { createClient } from "@/lib/supabase/server"

export type LoginState = { error: string } | { success: true } | null

export async function loginAction(
  prevState: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  })

  if (error) {
    return { error: error.message }
  }

  return { success: true }
}
