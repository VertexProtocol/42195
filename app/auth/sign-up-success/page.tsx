import Link from "next/link"
import { AuthShell } from "@/components/auth-shell"
import { Button } from "@/components/ui/button"

export default function SignUpSuccessPage() {
  return (
    <AuthShell
      title="Check your email"
      lede="We sent a confirmation link to your address. Open it to activate your account, then sign in."
      footer={
        <>
          Already confirmed?{" "}
          <Link
            href="/auth/login"
            className="font-semibold text-primary underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
        </>
      }
    >
      <Button asChild block variant="secondary">
        <Link href="/auth/login">Back to sign in</Link>
      </Button>
    </AuthShell>
  )
}
