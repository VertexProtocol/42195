# Training plan + preferanser + AI-bruk — gjennomgang

Gjennomgang av plan-genereringen (`app/api/ai/training-plan/route.ts`), safety-motoren
(`lib/training-safety.ts`), preferanse-flyten og hvordan vi bruker Claude.

Alle funn er knyttet til fil og linje. Nummererte funn er verifisert i koden — der noe er
reprodusert numerisk står regnestykket.

---

## 0. Den viktigste observasjonen først

**Vi betaler for en modell som tenker, og så kaster vi nesten alle tallene den produserer.**

Sekvensen i `route.ts` er:

1. Vi regner ut ukesvolum deterministisk (`calcWeekTargets` / `calcFullCycleTargets`).
2. Vi sender de tallene til Claude og ber den bruke dem "som utgangspunkt, du kan justere ±15%".
3. Claude returnerer uker med `targetKm` og økter med distanser.
4. `validateAndAdjustPlan` overskriver `targetKm`.
5. Comeback-cap overskriver `targetKm` på uke 1.
6. Korreksjonsløkka (`route.ts:1008-1058`) skalerer alle øktdistanser til å matche `targetKm`,
   bytter om på "Long run"-labelen, avrunder, og setter til slutt `targetKm` = summen av øktene.
7. `assignSessionPace` overskriver `suggestedPace`.

Etter steg 7 er **alt Claude sa om tall borte**. Det eneste som overlever er `summary`,
`theme`, `type`, `effort`-teksten, `purpose` og `coachNote`. Alt annet er deterministisk.

Det er ikke nødvendigvis feil arkitektur — deterministisk volumstyring er tryggere enn en
LLM. Men det har tre konsekvenser vi ikke har tatt inn over oss:

- Vi bruker thinking-tokens (opptil 8000) på planlegging av tall som forkastes.
- Claudes `summary` og `coachNote` beskriver volumene *den* foreslo, ikke de vi endte med.
  Når safety-motoren i tillegg prefikser `"Safety: reduced to 34 km (was 40, weekly cap)."`
  inn i `coachNote` (`training-safety.ts:718`), får brukeren en ukekommentar som både
  motsier seg selv og lekker intern maskineri.
- Instruksjonene i prompten om øktlengder ("minimum 5 km", "long run ≥ 8 km", "2 km lengre
  enn andre økter") håndheves ikke — korreksjonsløkka kan bryte alle sammen.

**Anbefaling:** velg én av to retninger, ikke bli stående mellom dem.
- (A) *Claude skriver, koden regner*: ta `targetKm` og `distance` helt ut av JSON-skjemaet.
  Vi sender ferdige tall inn, Claude returnerer kun `type`, `effort`, `purpose`, `theme`,
  `summary`, `coachNote` per økt/uke. Da forsvinner hele korreksjonsløkka, skalering,
  label-bytting og avrunding — ~50 linjer med den vanskeligste koden i fila.
- (B) *Claude foreslår, koden verifiserer*: behold tallene, men la safety-laget **avvise og
  be om ny generering** ved brudd i stedet for å skrive om i stillhet.

(A) er nesten helt sikkert riktig her, gitt hvor mye deterministisk logikk som allerede finnes.

---

## 1. Preferanser: hva de lover vs. hva de faktisk gjør

| Preferanse | Hva UI lover | Hva som faktisk skjer |
|---|---|---|
| `sessions_per_week` | 2–5 økter | Fungerer, men er kun et *ønske* til Claude. Avvik logges som `console.warn` (`route.ts:924`) og korrigeres aldri. Zod tillater 1–14 (`route.ts:1415`), UI tilbyr 2–5. |
| `focus` | 3 tydelig ulike planformer | **Nesten kosmetisk.** Brukes to steder: én setning i prompten (`route.ts:315-319`) og `skipSessionScaling` i checkpoint (`checkpoint/route.ts:154`). "Hit the km — sessions are flexible, no fixed structure required" gir likevel en rigid plan med N typede økter og faste distanser, fordi systemprompten og korreksjonsløkka hardkoder det. |
| `weekly_increase_pct` | 5 / 8 / 10 / 15 / 20 % | **Alt over athlete-taket blir fjernet igjen.** `MAX_WEEKLY_INCREASE` er 8 % (beginner) / 10 % (intermediate) / 12 % (advanced) (`training-safety-client.ts:39-43`). Velger du 15 % eller 20 %, bygger `calcWeekTargets` uker som `checkWeeklyLoadProgression` deretter klipper ned — og brukeren får `"Safety: reduced to X km"` i ukenotatene som straff for å ha brukt en knapp vi selv tilbød. |
| `block_weeks` | 2 / 3 / 4 / 6 uker | Fungerer, men se funn #3 (blockWeeks = 1 gir 2 uker). |
| `regenerate_every_weeks` | "Hvor ofte du vil lage ny plan — du får en påminnelse" | **Gjør i tillegg noe helt annet og udokumentert:** den er analysevindu for formberegningen (`route.ts:570`). Velger du 8 uker i stedet for 2, endres `currentAvgWeeklyKm`, trendlinja og hele planens utgangspunkt. En påminnelses-innstilling skal ikke flytte treningsgrunnlaget. |
| `plan_mode` | — | **Dødt.** `const [planMode] = useState(...)` uten setter (`goal-detail-screen.tsx:120`), ingen UI-kontroll. `full_cycle` kan ikke velges. Dermed er hele `calcFullCycleTargets` (`route.ts:160-217`, 57 linjer periodisering) død kode. |
| `injury_notes` | "Skader coachen bør huske" | Se funn #10 — akkumulerer for alltid og gjør planen gradvis mer konservativ. |

### 1b. Preferanse-API-et er splittet i to
`GET` og `PATCH` ligger på `/api/ai/training-plan/preferences`, mens `PUT` (lagring) ligger på
`/api/ai/training-plan`. Klienten treffer begge (`goal-detail-screen.tsx:133` og `:151`).
Det er ingen grunn til den delingen, og den gjør at `PUT` sitter i en 1565-linjers fil sammen
med plan-generering.

### 1c. Kolonner skrives i tre separate spørringer
`route.ts:1510-1553` skriver først basisfeltene, så `injury_notes` + `notes_history`, så
`plan_mode` — hver med sin egen begrunnelse om at "migrasjonen kanskje ikke er kjørt".
Migrasjonene finnes (`supabase/migrations/add_goal_preferences_injury_plan_mode.sql`) og er
idempotente. Resultatet nå er at et lagringskall kan lykkes delvis og returnere `ok: true`.
Slå sammen til én upsert.

---

## 2. Logiske brister

### #1 — Safety-motorens long run-cap blir omgjort av korreksjonsløkka
`checkLongRunProtection` (`training-safety.ts:466`) capper lengste økt til 35 % av ukevolumet.
Rett etterpå skalerer `route.ts:1027` alle økter opp igjen til å summere til `targetKm`, og
`route.ts:1052` gir long run **hele resten**.

Reprodusert numerisk (40 km-uke, 18/11/11):
```
etter safety-cap:   14 km / 11 km / 11 km   (long run = 35 %)
etter korreksjon:   16 km / 12 km / 12 km   (long run = 40 %)
```
Cappen er 100 % virkningsløs når long run finnes. Det er sikkerhetsregelen som beskytter mot
den vanligste løpeskaden, og den gjør ingenting.

### #2 — Tre ulike definisjoner av "recovery week" i samme request
- `training-safety.ts:100`: `curr < prev * 0.85` (`RECOVERY_WEEK_THRESHOLD`)
- `route.ts:973-975` (pace): `/recovery|deload/i` **eller** `targetKm < prev * 0.85`
- `route.ts:1014-1017` (volum-cap): `/recovery|deload|rest/i` **eller** `targetKm >= prev`

Den siste er direkte feil skrevet: den klassifiserer en uke som er *høyere* enn forrige som
"recovery". Den fungerer bare fordi den umiddelbart gates på `wi === weeks.length - 1`
(`route.ts:1018`) — så det er en kronglete måte å skrive "cap siste uke på 80 %". Bieffekt:
en ekte recovery-uke midt i blokka får ingen cap i det hele tatt, og `isRecovery` beregnes
for alle uker uten å brukes.

### #3 — `calcWeekTargets` gir 2 uker når `blockWeeks = 1`
`route.ts:141-153`: pusher uke 1, løkka `for (i=1; i < blockWeeks-1)` kjører ikke, pusher
recovery-uka. Med `blockWeeks = 1` blir det to targets, mens prompten sier "The weeks array
must have exactly 1 entries". `blockWeeks = 1` inntreffer når løpet er 7–13 dager unna
(`route.ts:335`).

### #4 — Trendlinja lyver ved kort historikk
`route.ts:359-364`: `priorWeeks = summaries.slice(w, w*2)`, men `priorAvg = sum / recentWindow`.
Har du 6 ukers historikk og `recentWindow = 4`, er `priorWeeks.length === 2` mens vi deler på 4
→ `priorAvg` halveres → prompten forteller Claude `"upward — 12.0 → 30.0 km/week (+150%)"`
for en løper som har vært helt stabil. Vaktposten på linje 361 fanger bare `length === 0`.

### #5 — To ulike ACWR-implementasjoner, to ulike risikovokabular, samme request
- `route.ts:612-622`: egen utregning, terskler `> 1.5 = high`, `> 1.3 = moderate`, ellers `low`.
- `training-safety.ts:262-307` (`evaluateAcwrSafety`): `computeACWR`, tersklene
  `ACWR_UNSAFE_THRESHOLD` / `ACWR_HIGH_THRESHOLD`, pluss en `moderate`-tier på `> 1.0` og en
  `no_baseline`-tier.

En løper på ACWR 1.15 får `"Injury risk (ACWR): 1.15 (low)"` i prompten, samtidig som
safety-motoren klassifiserer det som `moderate` og ganger uke 1 med 0.95. Prompt og motor er
uenige om samme tall i samme kall. Bruk `evaluateAcwrSafety` begge steder.

### #6 — Fire uavhengige volumreduksjoner stables multiplikativt
Ingen av dem vet om hverandre:
1. `calcWeekTargets` × 0.8 ved høy ACWR (`route.ts:130-134`)
2. `validateAndAdjustPlan` × `acwrSafety.weekOneMultiplier` (0.75–0.95) (`training-safety.ts:690-701`)
3. `prolongedFatigue.deloadMultiplier` × 0.60 — riktignok via `Math.min`, ikke produkt
4. `applyComebackCap` (`route.ts:947`)
5. Ukesprogresjonstaket klipper videre

En løper som kommer tilbake fra pause med forhøyet ACWR kan havne på `0.8 × 0.75 = 0.6` av et
utgangspunkt som allerede var konservativt, og så bli capped av comeback på toppen. Det finnes
ingen samlet nedre grense. Legg reduksjonene i én funksjon som tar `min` eller et eksplisitt
kombinasjonsprodukt med gulv.

### #7 — Fullførte økter migreres til feil kalenderuke ved regenerering
`route.ts:1178-1219` flytter `session_completions` fra gammel til ny plan ved å matche
`weekNumber` + `type`. Men den nye blokka starter **etter** den gamle
(`blockStartDate = prevBlockStart + prevWeekCount * 7`, `route.ts:1087`). Ny W1 er en helt
annen kalenderuke enn gammel W1. Resultatet er at framtidige økter markeres som fullført.
Migreringen bør enten droppes eller matche på dato, ikke ukenummer.

### #8 — Adherence teller sykling som løping
`route.ts:724-729` og `route.ts:744-746` filtrerer på dato, men **ikke** på `RUN_TYPES` —
til forskjell fra `weeklySummaries` (`route.ts:563`) og ACWR (`route.ts:610`) som begge
gjør det. En syklist får "142 % adherence" i prompten. Samme feil i klienten:
`weeklyActualKm` (`goal-detail-screen.tsx:1251-1263`) bruker alle aktiviteter, som gir feil
`skipWarning`.

### #9 — Server og klient parser distanser ulikt
`parseSessionDistanceKm` (`training-safety.ts:68`) returnerer **høy** ende av et intervall.
`parseSessionKm` (`goal-detail-screen.tsx:467-474`) returnerer **midtpunktet**. For "8–10 km"
gir serveren 10 og UI-et 9. Ukesummene i UI matcher da ikke `targetKm` serveren lagret.

### #10 — Skadehistorikk akkumulerer permanent
`hasActiveInjury` (`notes-history.ts:44`) er sann så lenge én oppføring mangler `resolved_at`.
Brukere trykker sjelden "Resolved". Konsekvenser:
- Comeback-cappen strammes med `COMEBACK_INJURY_REDUCTION` (0.80) på ubestemt tid.
- Alle uløste oppføringer sendes inn i prompten under *"Active — restrict volume/intensity"*
  (`notes-history.ts:110-114`), for alltid.
- Retter du en skrivefeil i skadenotatet, lages en **ny** oppføring (`route.ts:1504`) uten at
  den gamle løses — så Claude får to motstridende aktive skader.

Trenger enten auto-utløp (f.eks. 8 uker), eller at redigering erstatter i stedet for å legge til.

### #11 — Å rette en skrivefeil trigger regenerering som deretter blir blokkert
`containsNewActiveInjury` (`route.ts:1558`) returnerer `true` for enhver ny skadeoppføring,
inkludert en redigering. Klienten regenererer da automatisk — og møter 10-minutters cooldown
(`route.ts:505`) med en 429. Brukeren får en feilmelding for å ha rettet en skrivefeil.

### #12 — Rate limit brennes før validering
`checkAiRateLimit` (`route.ts:474`) inkrementerer teller før vi sjekker cooldown, eierskap av
mål, eller om løpsdatoen har passert. Trykker du regenerer tre ganger under cooldown, har du
brukt 3 av 20 AI-kall i timen uten at Claude har blitt kalt én gang. Flytt rate limit ned til
rett før `anthropic.messages.stream`.

### #13 — `getPhaseLabel` og prompten mener ulike ting med "phase"
`notes-history.ts:26` kaller seg *"Mirror of the phase logic in the plan generator"* og regner
base/build/taper ut fra `weekIndex / totalWeeks` i **blokka**. Plan-generatoren regner
`base-building / build / peak / taper` ut fra `daysUntilRace` (`route.ts:373-376`). Et notat
merket `"build"` betyr altså "uke 3 av en 4-ukers blokk", men leses av Claude som
"byggefasen i treningsplanen". To ulike taksonomier, samme ord, samme prompt.

### #14 — GET-ruten overskriver lagrede pacer og gjør dobbeltarbeid
`route.ts:1316-1372` regner ut `paceGuide` og setter `suggestedPace` på nytt ved hver GET,
basert på dagens fatigue/athlete-level. Pacene i UI-et endrer seg altså uten at planen er
endret. Deretter regnes `predictRaceTimes` + `buildPaceGuide` **én gang til** på linje 1398
bare for å hente ut `.source`. Dobbelt arbeid per sidelasting.

### #15 — Progresjonsmodifikatoren er knyttet til ukenummer, ikke dato
`route.ts:980`: `weekIndex = week.weekNumber - 1`. Uke 4 får alltid full progresjon, selv når
brukeren ser på planen dag 1. Bør være relativ til hvor i blokka man faktisk er.

---

## 3. AI-bruken

### 3.1 Modell og parametere er en generasjon bak
```ts
model: "claude-sonnet-4-6",
max_tokens: 10000,
thinking: { type: "enabled", budget_tokens: thinkingBudget },  // opptil 8000
```
- `thinking: {type:"enabled", budget_tokens}` er **deprecated** på Sonnet 4.6 og returnerer
  **400** på Sonnet 5 / Opus 5. Erstatningen er `thinking: {type:"adaptive"}` +
  `output_config: {effort: "..."}`.
- Anbefalt: `claude-sonnet-5` (bedre coding/agentic, samme tier) eller `claude-opus-5`.
  Merk at Sonnet 5 bruker ny tokenizer (~30 % flere tokens for samme tekst) — `max_tokens`
  må re-baselines.

### 3.2 `max_tokens` er for lav — planer over ~6 uker kan bli avkuttet
`budget_tokens` teller mot `max_tokens`. Med `thinkingBudget = 8000` og `max_tokens = 10000`
står det igjen **2000 tokens** til selve JSON-en. En 4-ukers plan med 3 økter er ~1200 tokens.
En 20-ukers full-cycle-plan er 5–6× det. Symptomet er `stop_reason: "max_tokens"` → avkuttet
JSON → `"No JSON found in Claude response"` (`route.ts:894`), som vi i dag rapporterer som en
generisk feil. Vi streamer allerede, så det er ingen timeout-grunn til å ligge lavt: sett
`max_tokens` til 32–64k og styr dybde med `effort` i stedet for `budget_tokens`.

### 3.3 Bruk structured outputs — fjern hele parse-feilklassen
I dag: regex `/\{[\s\S]*\}/` → `JSON.parse` → Zod (`route.ts:891-919`), med tre separate
feilstier. `output_config: {format: {type: "json_schema", schema}}` garanterer gyldig JSON mot
skjemaet, og `TrainingPlanSchema` finnes allerede — den kan konverteres direkte. Det fjerner
regexen, try/catch-en rundt parse, og `"No JSON found"`-grenen.

### 3.4 Prompt caching er sannsynligvis ikke aktiv
`COACHING_SYSTEM_PROMPT` er merket med `cache_control` (`route.ts:870`), men er bare ~1,1k
tokens. Minimum cachebar prefiks er 1024 for Sonnet 4.6/Sonnet 5 — vi ligger på grensa, og
under grensa cacher API-et i stillhet ingenting (ingen feil, bare
`cache_creation_input_tokens: 0`).

Vi logger ingen `usage`-felter noe sted, så vi vet ikke om cachen treffer, hva et kall koster,
eller hvor mange tokens vi bruker på thinking. Det bør logges:
`cache_read_input_tokens`, `cache_creation_input_tokens`, `input_tokens`, `output_tokens`.

> **Etterord — målt, ikke anslått.** Anslaget over traff verken tallet eller
> mekanismen. Målt med `messages.count_tokens` og bekreftet mot API-et
> (`scripts/smoke/smoke.mjs`): det cachebare prefikset rendres som `tools` →
> `system`, og et structured-output-skjema deler samme prefiks — så begge teller
> med. Minimum er dessuten per modell og ikke monotont: 512 for Opus 5, 4096 for
> Haiku 4.5.
>
> | Rute | Prefiks | Minimum | Cacher |
> |---|---:|---:|---|
> | `training-plan` | 1528 | 512 | ja |
> | `race-strategy` | 1098 | 512 | ja |
> | `coach` | 4594 | 4096 | ja |
> | `plan-check` | 412 | 4096 | nei |
> | `weekly-review` | 432 | 4096 | nei |
> | `activity-analysis` | 117 | 4096 | nei |
>
> `race-strategy` har en systemprompt på 156 tokens og cacher likevel — det er
> det 942 tokens store skjemaet som bærer den over grensa. `coach` cacher fordi
> de åtte verktøyskjemaene ligger foran systemprompten; prompten alene (~3100)
> ville ikke nådd opp. De tre nederste kan ikke nå minimumet og fikk
> breakpointene fjernet.

### 3.5 Prompten er skrevet for en eldre modellgenerasjon
Nyere modeller følger systemprompten langt tettere, så trykk-språk overtriggrer nå:
- `"IMPORTANT: Do not specify which day of the week to run"` (`route.ts:459`)
- `"HARD CAP — do not exceed"` / `"MUST NOT exceed"` (`route.ts:440-442`)
- `"Never use only 'Long run' and 'Easy run'"`, `"Never schedule..."`, `"Always include..."`

Systemprompten inneholder også regler som er ren duplisering av deterministisk kode
(minimum øktlengde, long run ≥ 8 km, long run 2 km lengre enn andre, ordering av økter).
Alle håndheves — eller brytes — av korreksjonsløkka uansett. Se punkt 0: hvis vi går for (A),
kan hele *Session Distribution Rules*-seksjonen strykes.

### 3.6 Ingen retry, ingen fallback, ingen delvis redning
Ved 529/overload eller ugyldig JSON får brukeren en feilmelding, har brukt et rate-limit-slot,
og må vente. Minimum: retry én gang på `overloaded_error` / `api_error`. SDK-en retryer
allerede 429/5xx to ganger by default — men det gjelder ikke JSON-valideringsfeil, som er den
feilen vi faktisk ser.

### 3.7 Mindre punkter
- `adjustNote` saneres tegnvis (`route.ts:484`) og interpoleres så rått inn i prompten mellom
  fnutter. Lav risiko (brukeren angriper sin egen plan), men grensen er verdt å kjenne.
- Feil returneres som SSE `{status:"error"}` med HTTP 200. Klienten må parse for å oppdage feil.
- De andre AI-rutene (`activity-analysis`, `weekly-review`, `plan-check`) bruker
  `claude-haiku-4-5-20251001` med `temperature: 0` — det er greit, men modell-ID-en har
  unødvendig datosuffiks; `claude-haiku-4-5` er aliaset.

---

## 4. Foreslått rekkefølge

**Rett først (feil brukeren merker):**
1. #1 long run-cappen som ikke virker
2. #8 adherence teller sykling
3. #7 fullførte økter migreres til feil uke
4. #12 rate limit brennes før validering, og #11 skrivefeil → 429

**AI-laget (én samlet endring):**
5. Modell + `adaptive thinking` + `effort` + høyere `max_tokens` + structured outputs.
   Disse henger sammen og bør gjøres i én PR med logging av `usage` slik at vi kan måle før/etter.

**Rydding av logikk:**
6. Én ACWR-implementasjon (#5), én recovery-definisjon (#2), én reduksjonsberegning (#6)
7. #4 trendlinja, #3 blockWeeks=1, #9 parse-inkonsistens, #13 phase-taksonomi

**Preferansene (produktbeslutning kreves):**
8. Bestem hva `focus` faktisk skal styre — eller fjern valget
9. Enten koble `weekly_increase_pct` til safety-taket, eller fjern 15/20 %-knappene
10. Skill `regenerate_every_weeks` fra analysevinduet
11. `plan_mode`: enten bygg UI-et og aktiver full_cycle, eller slett `calcFullCycleTargets`
12. Auto-utløp / erstatning på skadenotater (#10)

**Til slutt:**
13. Punkt 0 — flytt tall helt ut av Claudes ansvar, og slett korreksjonsløkka.
