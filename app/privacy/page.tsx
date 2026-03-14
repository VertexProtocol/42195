import Link from "next/link"

export const metadata = {
  title: "Privacy Policy - 42195",
  description: "Privacy policy for the 42195 training tracker application",
}

export default function PrivacyPolicyPage() {
  return (
    <div className="mx-auto max-w-2xl px-5 py-10">
      <Link
        href="/"
        className="mb-6 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        &larr; Back to app
      </Link>

      <h1 className="text-3xl font-bold text-foreground mb-2">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground mb-8">Last updated: March 14, 2026</p>

      <div className="prose prose-sm prose-neutral dark:prose-invert space-y-6">
        <section>
          <h2 className="text-xl font-semibold text-foreground mb-2">1. Introduction</h2>
          <p className="text-muted-foreground leading-relaxed">
            42195 (&quot;we&quot;, &quot;our&quot;, or &quot;the app&quot;) is a training tracker that
            helps runners monitor their progress. This privacy policy explains what data we collect,
            how we use it, and your rights regarding your personal information.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-2">2. Data We Collect</h2>
          <p className="text-muted-foreground leading-relaxed mb-2">
            When you use 42195, we collect and store the following data:
          </p>
          <ul className="list-disc pl-5 text-muted-foreground space-y-1">
            <li><strong>Account information:</strong> Your email address and display name, used for authentication.</li>
            <li><strong>Activity data:</strong> Running activities including distance, duration, pace, heart rate, cadence, elevation, and route data. This may be imported from Strava or entered manually.</li>
            <li><strong>Goals and preferences:</strong> Training goals, weekly targets, and training plan preferences you set within the app.</li>
            <li><strong>Strava integration:</strong> When you connect Strava, we store OAuth tokens to sync your activities. We access your activity data through the Strava API.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-2">3. How We Use Your Data</h2>
          <ul className="list-disc pl-5 text-muted-foreground space-y-1">
            <li>Display your training activities, progress, and statistics.</li>
            <li>Track progress toward your goals.</li>
            <li>Generate AI-powered training plans and coaching insights.</li>
            <li>Calculate training load and recovery metrics.</li>
            <li>Sync activities from your connected Strava account.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-2">4. Data Storage and Security</h2>
          <p className="text-muted-foreground leading-relaxed">
            Your data is stored securely in Supabase with row-level security (RLS) policies ensuring
            that each user can only access their own data. Strava OAuth tokens are stored server-side
            and are never exposed to the browser. All data is transmitted over HTTPS.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-2">5. Third-Party Services</h2>
          <ul className="list-disc pl-5 text-muted-foreground space-y-1">
            <li><strong>Supabase:</strong> Database and authentication provider.</li>
            <li><strong>Strava:</strong> Activity data is fetched via the Strava API when you connect your account. We comply with Strava&apos;s API Agreement.</li>
            <li><strong>Vercel:</strong> Hosting and analytics.</li>
            <li><strong>Anthropic (Claude):</strong> AI-powered training plans and coaching use Claude. Your activity data may be sent to Anthropic for analysis. No data is retained by Anthropic beyond the API request.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-2">6. Data Retention</h2>
          <p className="text-muted-foreground leading-relaxed">
            We retain your data for as long as your account is active. Cached activity stream data
            (GPS, heart rate, pace time-series) is automatically refreshed every 7 days. You can
            request deletion of your account and all associated data at any time.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-2">7. Your Rights</h2>
          <p className="text-muted-foreground leading-relaxed mb-2">You have the right to:</p>
          <ul className="list-disc pl-5 text-muted-foreground space-y-1">
            <li><strong>Access:</strong> View all data we store about you within the app.</li>
            <li><strong>Deletion:</strong> Delete your account and all associated data from the Profile screen or via the account deletion API.</li>
            <li><strong>Disconnect:</strong> Revoke Strava access at any time through Strava&apos;s settings or by reconnecting in the app.</li>
            <li><strong>Export:</strong> Your activity data is accessible through the app and the Strava API.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-2">8. Strava Data Usage</h2>
          <p className="text-muted-foreground leading-relaxed">
            In accordance with the Strava API Agreement: we only access data you have explicitly
            authorized; we do not sell or share your Strava data with third parties; we delete your
            Strava data when you disconnect your account or request account deletion; cached Strava
            data is refreshed periodically and not stored indefinitely.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-2">9. Changes to This Policy</h2>
          <p className="text-muted-foreground leading-relaxed">
            We may update this privacy policy from time to time. Changes will be reflected on this
            page with an updated &quot;Last updated&quot; date.
          </p>
        </section>

        <section>
          <h2 className="text-xl font-semibold text-foreground mb-2">10. Contact</h2>
          <p className="text-muted-foreground leading-relaxed">
            If you have questions about this privacy policy or your data, please open an issue on
            our GitHub repository or contact us through the app&apos;s support page.
          </p>
        </section>
      </div>
    </div>
  )
}
