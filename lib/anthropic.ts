import Anthropic from "@anthropic-ai/sdk"

/**
 * Shared Anthropic client for all AI features.
 *
 * STRAVA API COMPLIANCE NOTE (Section 2.14.iv):
 * Strava's API Agreement prohibits using Strava data to train AI models.
 * This client is used exclusively for real-time inference — generating
 * personalised responses for the authenticated user — never for model
 * training or dataset construction.
 *
 * Anthropic's API usage policy states that data submitted via the API is
 * NOT used to train models by default. See:
 * https://www.anthropic.com/legal/privacy
 *
 * No Strava activity data is retained by Anthropic beyond the scope of
 * processing a single API request.
 */
export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: {
    // Explicitly signal that submitted data must not be used for training.
    // This reinforces Anthropic's default no-training policy at the
    // request level for every call that touches Strava data.
    "X-Anthropic-No-Train": "true",
  },
})
