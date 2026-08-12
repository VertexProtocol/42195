import { authErrorKey } from "@/lib/auth-error"
import { safeNext } from "@/lib/auth-redirect"
import { AuthErrorScreen } from "./auth-error-screen"

export default async function AuthErrorPage({
  searchParams,
}: {
  searchParams: Promise<{ message?: string; next?: string }>
}) {
  const { message, next } = await searchParams

  return <AuthErrorScreen messageKey={authErrorKey(message)} next={safeNext(next)} />
}
