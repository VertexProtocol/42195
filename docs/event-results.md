# Strava event results

Event completion is separate from performance benchmarks and from a race time target.

- Only imported outdoor Run, Race and Trail Run activities qualify. Manual, virtual and non-running activities do not.
- Candidates are within one local calendar day and 3% of the target distance. Old imports without local date use UTC only to offer a confirmation, never to auto-complete.
- Auto-completion requires exactly one strong candidate: same local date, within 1% distance, and either Strava Race type or target distance of at least 20 km. These thresholds are conservative product heuristics, not official race verification.
- Short unmarked runs, adjacent dates, larger GPS deviations and multiple strong matches require confirmation. The runner can reject a match, review matches again, or choose a candidate. Choices persist on the goal; changing date/distance or deleting the activity invalidates incompatible evidence.
- Only positive elapsed time at least as long as moving time is compared with the time goal. It is not pace-scaled. Missing elapsed time means unknown, not failure or success. Strava elapsed time is not an official chip time.
- Completed event goals move into history, including on race day. Without evidence, elapsed dates remain Ended.
- Shared-group standings remain settled, but the outcome can change after a late sync or explicit correction.

Migration adds optional activity elapsed/local-date fields and goal result choices, preserving existing owner-only RLS. New imports and webhook updates carry the metadata. Incremental sync also refreshes the already-fetched boundary page; full resync fills older history. Existing imports work as confirmation candidates without requiring a bulk backfill.

Validation: focused matcher, mapping, authenticated API, UI correction and existing goal/Home/shared screen tests; TypeScript. Run date-dependent legacy UI suites with TZ=UTC (fixtures use date-only timestamps). Authenticated browser inspection is still outstanding.
