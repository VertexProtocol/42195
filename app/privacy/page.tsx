import Link from "next/link"

export const metadata = {
  title: "Privacy Policy - 42195",
  description: "Privacy policy for the 42195 training tracker application",
}

export default function PrivacyPolicyPage() {
  return (
    <div className="mx-auto max-w-[68ch] px-5 py-10">
      <Link
        href="/"
        className="press mb-7 inline-flex items-center gap-1.5 text-label font-medium text-muted-foreground hover:text-foreground"
      >
        &larr; Back to app
      </Link>

      <h1 className="mb-2 text-screen font-semibold text-foreground">Privacy Policy</h1>
      <p className="mb-9 text-label text-muted-foreground">Last updated: March 21, 2026</p>

      <div className="space-y-6">
        <section>
          <h2 className="mb-2 mt-8 text-title font-semibold text-foreground">1. Introduction</h2>
          <p className="text-body leading-relaxed text-muted-foreground">
            42195 (&quot;we&quot;, &quot;our&quot;, or &quot;the app&quot;) is a training tracker that
            helps runners monitor their progress. This privacy policy explains what data we collect,
            how we use it, and your rights regarding your personal information.
          </p>
        </section>

        <section>
          <h2 className="mb-2 mt-8 text-title font-semibold text-foreground">2. Data We Collect</h2>
          <p className="mb-2 text-body leading-relaxed text-muted-foreground">
            When you use 42195, we collect and store the following data:
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-body leading-relaxed text-muted-foreground">
            <li><strong>Account information:</strong> Your email address and display name, used for authentication.</li>
            <li><strong>Activity data:</strong> Running activities including distance, duration, pace, heart rate, cadence, elevation, and route data. This may be imported from Strava or entered manually.</li>
            <li><strong>Goals and preferences:</strong> Training goals, weekly targets, and training plan preferences you set within the app.</li>
            <li><strong>Strava integration:</strong> When you connect Strava, we store OAuth tokens to sync your activities. We access your activity data through the Strava API.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 mt-8 text-title font-semibold text-foreground">3. How We Use Your Data</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-body leading-relaxed text-muted-foreground">
            <li>Display your training activities, progress, and statistics.</li>
            <li>Track progress toward your goals.</li>
            <li>Generate AI-powered training plans and coaching insights.</li>
            <li>Calculate training load and recovery metrics.</li>
            <li>Sync activities from your connected Strava account.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 mt-8 text-title font-semibold text-foreground">4. Data Storage and Security</h2>
          <p className="text-body leading-relaxed text-muted-foreground">
            Your data is stored securely in Supabase with row-level security (RLS) policies ensuring
            that each user can only access their own data. Strava OAuth tokens are stored server-side
            and are never exposed to the browser. All data is transmitted over HTTPS.
          </p>
        </section>

        <section>
          <h2 className="mb-2 mt-8 text-title font-semibold text-foreground">5. Third-Party Services</h2>
          <ul className="list-disc space-y-1.5 pl-5 text-body leading-relaxed text-muted-foreground">
            <li><strong>Supabase:</strong> Database and authentication provider. Your data is isolated by row-level security so no other user can access it.</li>
            <li><strong>Strava:</strong> Activity data is fetched via the Strava API when you connect your account. We comply with Strava&apos;s API Agreement. See Section 8 for full details.</li>
            <li><strong>Vercel:</strong> Hosting provider. Vercel Analytics collects only aggregate page-view metrics and does not receive any of your personal activity data.</li>
            <li><strong>Anthropic (Claude):</strong> AI-powered features (training plans, activity coaching, race strategy) use Claude. Your aggregated running metrics are sent to Anthropic&apos;s API for real-time inference only. Anthropic does not use API-submitted data to train its models by default, and we additionally send an explicit opt-out header (<code>X-Anthropic-No-Train</code>) on every request. No Strava data is retained by Anthropic beyond processing the individual request. Raw GPS data, social data, or any other users&apos; data is never sent to Anthropic.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 mt-8 text-title font-semibold text-foreground">6. Data Retention</h2>
          <p className="mb-2 text-body leading-relaxed text-muted-foreground">
            We retain your data for as long as your account is active. You can request deletion at
            any time (see Your Rights below).
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-body leading-relaxed text-muted-foreground">
            <li><strong>Activity stream data</strong> (heart rate, pace, altitude time-series) is cached for up to 7 days. Stale cache entries are explicitly deleted after that period in accordance with Strava&apos;s API Agreement §7.</li>
            <li><strong>Strava-derived data</strong> (activities, training plans, analyses, tokens) is deleted immediately and automatically if you revoke Strava access, either through Strava&apos;s settings or the app. See Section 8.</li>
            <li><strong>AI-generated content</strong> (training plans, activity analyses) is stored only to serve it back to you on future visits. It is deleted when you delete your account or disconnect Strava.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 mt-8 text-title font-semibold text-foreground">7. Your Rights</h2>
          <p className="mb-2 text-body leading-relaxed text-muted-foreground">You have the right to:</p>
          <ul className="list-disc space-y-1.5 pl-5 text-body leading-relaxed text-muted-foreground">
            <li><strong>Access:</strong> View all data we store about you within the app.</li>
            <li><strong>Deletion:</strong> Delete your account and all associated data from the Profile screen. This permanently removes your activities, training plans, goals, and authentication account.</li>
            <li><strong>Disconnect Strava:</strong> Revoke Strava access at any time through Strava&apos;s authorised apps settings. When you do, we automatically and immediately delete all Strava-derived data from our systems (activities, streams, training plans, analyses, and OAuth tokens). Your app account is retained so you can reconnect if you choose.</li>
            <li><strong>Withdraw AI consent:</strong> You may request that we delete all AI-generated content (training plans, activity analyses) by contacting us or deleting your account.</li>
            <li><strong>Export:</strong> Your activity data is visible within the app. For a full data export, you can use Strava&apos;s own data export tool from your Strava account settings.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 mt-8 text-title font-semibold text-foreground">8. Strava Data Usage</h2>
          <p className="mb-2 text-body leading-relaxed text-muted-foreground">
            In accordance with the Strava API Agreement:
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-body leading-relaxed text-muted-foreground">
            <li>We only access the Strava data you have explicitly authorised (running activity metrics: distance, duration, pace, heart rate, elevation).</li>
            <li>Your Strava data is displayed only to you — it is never shared with other users, sold, or disclosed to advertisers or data brokers.</li>
            <li>Strava data is <strong>not</strong> used to train any AI or machine learning model, in accordance with Strava API Agreement §2.14.iv. It is used exclusively for real-time inference to generate personalised outputs for you.</li>
            <li>When you revoke Strava authorisation, our systems receive a webhook notification from Strava and <strong>automatically delete</strong> all Strava-derived data within seconds, in compliance with API Agreement §5.4.</li>
            <li>Activity stream cache (heart rate, pace, altitude time-series) is deleted after 7 days, in compliance with API Agreement §7.</li>
            <li>We do not process or aggregate Strava data for analytics, product improvement, or any purpose other than providing features directly to you.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 mt-8 text-title font-semibold text-foreground">9. AI Data Use Policy</h2>
          <p className="mb-2 text-body leading-relaxed text-muted-foreground">
            42195 uses Anthropic&apos;s Claude API to power training plans, activity coaching, race strategy, and the coach assistant. The following rules govern how your data interacts with AI:
          </p>
          <ul className="list-disc space-y-1.5 pl-5 text-body leading-relaxed text-muted-foreground">
            <li><strong>Inference only:</strong> Your data is sent to Anthropic solely to generate a personalised response for you in that moment. It is not stored, indexed, or used in any training pipeline.</li>
            <li><strong>No model training:</strong> We send an explicit <code>X-Anthropic-No-Train</code> header on every API request, instructing Anthropic not to use the submitted data for model training. Anthropic&apos;s standard API policy already prohibits training on customer data by default.</li>
            <li><strong>Minimum data:</strong> Only aggregated metrics relevant to your specific request are sent (e.g. weekly distance summaries, average paces, heart rate zones). Raw GPS coordinates, social data, or identifiers are never sent to Anthropic.</li>
            <li><strong>User-specific:</strong> AI features only ever process your own data to generate output for you. No other user&apos;s data is included in your AI requests.</li>
            <li><strong>No third-party AI sharing:</strong> Strava data is sent only to Anthropic for inference. It is not sent to any other AI platform, analytics tool, or third-party service.</li>
          </ul>
        </section>

        <section>
          <h2 className="mb-2 mt-8 text-title font-semibold text-foreground">10. Security Incidents</h2>
          <p className="text-body leading-relaxed text-muted-foreground">
            We maintain appropriate technical and organisational measures to protect your data.
            In the event of a personal data breach, we will notify affected users and, where required,
            the relevant supervisory authority within 72 hours of becoming aware of the incident.
            We will also notify Strava within 24 hours of any breach involving Strava data, in
            accordance with the Strava API Agreement §2.8. If you discover or suspect a security
            issue, please contact us immediately.
          </p>
        </section>

        <section>
          <h2 className="mb-2 mt-8 text-title font-semibold text-foreground">11. Changes to This Policy</h2>
          <p className="text-body leading-relaxed text-muted-foreground">
            We may update this privacy policy from time to time. Changes will be reflected on this
            page with an updated &quot;Last updated&quot; date.
          </p>
        </section>

        <section>
          <h2 className="mb-2 mt-8 text-title font-semibold text-foreground">12. Contact</h2>
          <p className="text-body leading-relaxed text-muted-foreground">
            If you have questions about this privacy policy or your data, please open an issue on
            our GitHub repository or contact us through the app&apos;s support page.
          </p>
        </section>
      </div>
    </div>
  )
}
