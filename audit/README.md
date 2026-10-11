# Rettelser etter gjennomgangen

Funnene nedenfor er den opprinnelige gjennomgangen. Regresjonstestene er nå endret til å kreve rettet oppførsel. Produksjonskode er endret på denne grenen.

- Volum starter fra historikken, og øktfrekvens håndheves før fordeling.
- Manglende historikk er ukjent; planoppretting ber om registrering/synkronisering før personalisering.
- Coach og plan bruker 84 dagers historikk for løperstatus.
- Aktiv skade bruker den eksisterende reduksjonsregelen også uten treningsopphold.
- Konkurranser kan ikke løfte treningsrammen; konflikter stopper generering med forklaring.
- Aktive planjusteringer beholder kalenderperioden, tidligere uker og registrerte økter.
- Øktlengder begrenses ut fra tidligere lengste tur, og volum som ikke får plass tvinges ikke inn.
- UI støtter 1–14 økter og forklarer doble økter; dette er fortsatt økter uten dagfestet kalender.
- Kvalitetsøkter krever manuell bekreftelse; store avvik i rolige økter matcher ikke automatisk.
- Personlige rekorder rangeres etter tiden som vises; sykling teller ikke som løping.
- Terskeltester eldre enn 90 dager forkastes; kvalitetstempo oppdiktes ikke fra rolig fart alene.
- Langdistanseprognoser krever mer historikk; intervallgrenser er sortert og inkluderer estimatet.
- Grønn uke-hake krever at alle øktene er gjennomført, ikke hoppet over.

Testgrenser: ingen faktiske AI-svar eller innloggede databaseflyter er verifisert av enhetstestene. Nye brukere uten løpeturer får foreløpig en forklaring og registreringsoppfordring, ikke en egen løp/gange-veiviser. Disse rettelsene etablerer ikke en medisinsk validert treningsmodell.

---

# 42195 – profil- og logikkgjennomgang

Gjennomgått kodegrunnlag: `638e5600de8e6f2289a814825d9eaa8393700de3`.

## Omfang og bevis

929 eksisterende tester bestod i UTC. I tillegg bestod 30 nye karakteriseringstester fordelt på 14 profiler og konkrete avvik. Disse testene **bekrefter dagens oppførsel, også feilene**; grønt resultat betyr ikke at oppførselen er ønskelig. Ved retting skal relevante påstander erstattes av regresjonstester for ønsket oppførsel.

Kjør: `TZ=UTC npx vitest run audit/`. Råresultater finnes i `profile-results.json`. Profilklokken er fast, 11. oktober 2026 kl. 12 UTC. Testdata er syntetiske. Ukesoppsummeringen er testet gjennom den faktiske React-hooken. Ingen ekte treningsdata er endret, og ingen produksjonskode er endret i denne gjennomgangen.

Dette er kode-, beregnings- og klientlogikktesting. Det er ikke nye innloggede nettleserøkter, nye databasekontoer eller en ende-til-ende-test av faktiske modellgenererte svar. Nettlesertilgangen var blokkert av den tidligere sesjonens beskyttelse av legitimasjon. AI-øktvalg, faktisk lagring og synkronisering på tvers av enheter er derfor ikke verifisert her. Der eksempler bruker økttyper, er disse eksplisitt gitt til den samme deterministiske fordeleren som API-et bruker.

## Profilmatrise

| Syntetisk profil | Beregnet ukesmengde, uke 1–4 | Observasjon |
|---|---|---|
| Ingen historikk, 3 ønskede økter | 3 / 3 / 3 / 2 km | Antas å ha hatt 365 dagers opphold |
| Første registrerte tur på 2 km | 11 / 12 / 13 / 10 km | ACWR merkes `unsafe`, men første uke økes likevel til 11 km |
| Nybegynner, 2 × 2 km/uke i 8 uker | 15 / 16 / 17 / 13 km | Minimumslengder blåser opp første uke |
| Mosjonist, 3 × 7 km/uke | 21 / 23 / 25 / 20 km | Ingen tilsvarende motstrid i denne volumtesten |
| Erfaren, 5 × 12 km/uke | 60 / 66 / 73 / 58 km | Beregnet langtur 21 km fra tidligere lengste 12 km |
| Proffprofil, 10 × 12 km/uke, 10 ønskede økter | 120 / 132 / 145 / 116 km | Motor/API støtter dette, grensesnittet tilbyr ikke 10 |
| Erfaren, bare én uke importert | 21 / 23 / 25 / 20 km | Tolkes som beginner i motoren og `unsafe` ACWR |
| 40 km/uke før 14 dagers opphold | 26 / 29 / 32 / 25 km | Opptrapping finnes; frekvensvarsel håndheves ikke |
| 40 km/uke før 50 dagers opphold | 14 / 15 / 17 / 13 km | Coachen får annet grunnlag og anbefaler 3 km |
| 100 dagers opphold, utenfor API-vinduet | 3 / 3 / 3 / 2 km | Samme resultat som helt ny bruker |
| 40 km/uke, aktiv skademerknad, siste tur nylig | 40 / 44 / 48 / 38 km | Ingen endring i comeback-/volummotoren fra skademarkeringen |
| Nybegynner 4 km/uke, velger 5 økter | 25 / 27 / 29 / 23 km | Frekvensmotor anbefaler maks 3, planen beholder 5 |
| Proffprofil 120 km/uke, velger UI-maks 5 økter | 120 / 132 / 145 / 116 km | Fordeling med én langtur blir 42 + 4 × 19,5 km |
| Nybegynner 4 km/uke, ber API om 7 økter | 35 / 38 / 41 / 32 km | Ekstra API-grensetest; 7 er ikke valgbart i UI |

## P1 – rett før ytterligere kosmetiske forbedringer

### 1. Første uke kan hoppe langt over faktisk treningsgrunnlag

**Reprodusert:** 4 km/uke blir 15 km ved tre økter og 25 km ved fem. Koden prioriterer minimumslengder for øktene. Begrensningen fra uke til uke starter først mellom planens uke 1 og 2; den kumulative kontrollen hopper over lave referansevolumer.

**Konsekvens:** Flere ønskede økter øker totalvolumet kraftig, i stedet for at eksisterende volum fordeles. Påstanden om at progresjonsreglene allerede er håndtert blir misvisende.

**Anbefaling:** Fastsett første ukes totale belastning fra dokumentert grunnlag før øktantall og lengder. Tillat korte økter og løp/gange eller tidsbaserte økter for ferske løpere. Ikke la minimumslengder overstyre totalrammen.

**Kode:** `lib/training-volume.ts`, `lib/training-safety.ts`, `lib/training-sessions.ts`.

### 2. «Juster planen» starter neste blokk i stedet for å justere den aktive

**Reprodusert beregning og kontrollert kallkjede:** En aktiv fireukersblokk som starter 5. oktober, får 2. november som ny startdato ved generering 11. oktober. UI sender `adjustNote`, men datoberegningen skiller ikke mellom justering og neste blokk.

**Konsekvens:** En forespørsel om endring nå kan erstatte aktiv plan med en fremtidig plan. Dato-/statusmigrering kan også miste sammenhengen med allerede gjennomførte økter. Dette siste er kildekontrollert, ikke databaseverifisert.

**Anbefaling:** Separate operasjoner: juster resterende aktive uker, start på nytt fra valgt dato, og lag neste blokk. Bevar gjennomførte økter og forklar hvilken periode som endres.

**Kode:** `components/screens/goal-detail-screen.tsx`, `app/api/ai/training-plan/route.ts`, `lib/training-block.ts`.

### 3. Manglende data blir oppdiktet historikk; coach og plan er uenige

**Reprodusert:** Ingen aktiviteter blir nøyaktig 365 dagers opphold. Ved et faktisk 50-dagers opphold beregner planen 14 km, mens coachens 42-dagers historikk gir «365-day gap» og 3 km. Planen bruker 84 dager.

**Anbefaling:** Skill eksplisitt mellom ingen erfaring, ufullstendig import, ukjent treningshistorikk og bekreftet opphold. Bruk én felles beregnet løperstatus på tvers av coach og plan. Hent siste kjente aktivitet separat fra analysevinduet. Ikke gjør fravær av data til et kjent antall pausedager.

**Foreslått tekst:** «Vi mangler nok historikk til å beregne et godt utgangspunkt. Har du trent regelmessig den siste tiden?»

**Kode:** `lib/training-comeback.ts`, begge AI-rutene.

### 4. Registrert konkurranse kan overstyre volumgrensene

**Reprodusert:** En ekstra maraton i uke 1 gjør `[3, 3, 3, 2]` til `[47, 3, 3, 2]`. `holdRaceWeeks` legger konkurransedistanse + 5 km som gulv etter sikkerhetsbegrensningene.

**Anbefaling:** Vis konflikt mellom kalender og treningsgrunnlag. Ikke omform en registrert konkurranse til en automatisk anbefaling om å gjennomføre hele distansen. Konkurransens plass i planen må avklares, og sluttsummen må valideres etter alle transformasjoner.

**Kode:** `lib/training-block.ts`, `app/api/ai/training-plan/route.ts`.

### 5. Skademerknad og frekvensregler er ikke deterministisk håndhevet

**Reprodusert:** Aktiv skade med nylig løping gir samme comebackresultat som uten skade. En løper med to økter per uke får anbefalt maksimum tre, men kan velge fem og beholde fem. Coachinstruksjonen sier derimot at antallet begrenses automatisk.

Skade er formidlet til AI-prompten, så funnet betyr ikke at appen fullstendig ignorerer skade. Problemet er at volum samtidig gis til modellen som allerede fastsatt og deretter fordeles av kode.

**Anbefaling:** Definer hva skadestatus faktisk skal utløse i produktet, inkludert oppfølgingsspørsmål og tilpasning av aktiv plan. Håndhev vedtatte frekvensregler i samme kode som bygger planen. Fjern påstander om beskyttelse som bare finnes som prompttekst eller loggvarsel.

**Kode:** `lib/training-comeback.ts`, `lib/training-safety.ts`, begge AI-rutene.

## P2 – korrekt registrering og troverdig veiledning

### 6. Rolig tur kan bli «gjennomført terskeløkt»

**Reprodusert:** Planlagt 10 km på 4:00–4:10/km fullføres automatisk av 10 km på 7:00/km. Fart brukes bare til rangering av mulige treff; det finnes ingen grense for å avvise et dårlig treff.

**Anbefaling:** Skill mellom «aktivitet funnet», «foreslått kobling» og «bekreftet gjennomført». Bruk øktstruktur når den er tilgjengelig; gjennomsnittsfart alene er spesielt lite egnet for intervaller med oppvarming og pauser. La brukeren bekrefte tvetydige treff.

**Kode:** `lib/plan-session-match.ts`.

### 7. Personlig rekord kan bli langsommere enn en tidligere tur

**Reprodusert:** Flat 5 km på 25:00 taper mot 5 km på 27:00 med 100 høydemeter. Utvelgelsen bruker høydejustert tid, mens «rekorden» viser faktisk tid 27:00.

**Anbefaling:** Personlig rekord skal rangere den tiden som faktisk vises. Eventuell høydejustert prestasjon må være en separat, tydelig estimert størrelse. Skill også faktiske distanser fra normaliserte tider for turer innenfor ±5 % av distansen.

**Kode:** `lib/training-utils.ts`, `detectPersonalRecords`.

### 8. Ukeskortet teller sykling som løping

**Reprodusert gjennom React-hook:** 5 km løping + 60 km sykling gir 65 km og `run_count = 2`. Home viser dette med løpeetiketten.

**Anbefaling:** Egen løpsoppsummering, eventuelt separat total treningstid på tvers av idretter. Uke- og planmål må bruke samme aktivitetsfilter som etiketten lover.

**Kode:** `hooks/use-app-data.ts`, `components/screens/home-screen.tsx`.

### 9. Gamle tester styrer dagens fart; prognoser er for bastante ved lite data

**Reprodusert:** En terskeltest fra 2019 på 4:00/km blir fortsatt dagens terskelfart. Én 3 km-tur på 6:00/km gir maratonestimat 4:56:41. Det er en matematisk ekstrapolasjon, ikke dokumentasjon på maratonkapasitet. For nedskalering fra 10 km til 5 km er dessuten lav/høy-grensene omvendt: 1763 og 1691 sekunder.

**Anbefaling:** Vurder alder, kontinuitet og testens relevans før fart settes. Vis datagrunnlag og usikkerhet, og undertrykk presise langtids-/langdistanseestimater når grunnlaget ikke støtter dem. Sorter intervallgrenser og kontroller at punktestimatet er innenfor dem. Grensefeilen er i beregningen; den er ikke bekreftet som synlig intervall i UI.

**Foreslått tekst:** «Foreløpig estimat basert på én kort tur. Vi har ikke nok grunnlag for et pålitelig maratonanslag.»

**Kode:** `lib/pace-guide.ts`, `lib/training-utils.ts`, testløpsspørringene i planruten.

### 10. Proffprofilen støttes ikke godt nok av øktmodellen

**Reprodusert:** 120 km/uke fordeles til 42 km langtur selv om samtlige tidligere turer var 12 km. Med UI-maks fem økter blir øvrige turer 19,5 km. API godtar 1–14 økter, mens UI tilbyr 2–5.

**Anbefaling:** Skill treningsdager fra økter, støtt doble økter eksplisitt og bruk tidligere langturer og varighet i langturberegningen. En prosent av ukesmengden alene gir ikke en tilstrekkelig individuell økt. UI og API må ha samme bevisste støttenivå.

**Kode:** `lib/training-sessions.ts`, preferanseskjemaet og `app/api/ai/training-plan/preferences/route.ts`.

### 11. Svært lite volum kan gi økter på 0 km

**Reprodusert motor/API-grensetest:** 3 km fordelt på sju økter med balanced-fokus gir minst én nulløkt. Volumfokus reduserer antall økter; andre fokus beholder antallet. UI tilbyr bare opptil fem, så akkurat sjuøkterscaset er ikke vanlig UI-bruk.

**Anbefaling:** Valider meningsfulle økter for alle fokus etter fordeling. Antall økter må være underordnet den faktiske rammen, uten at rammen blåses opp for å få øktene til å passe.

**Kode:** `lib/training-sessions.ts`, monteringen av planen i API-ruten.

### 12. «Ferdigbehandlet» og «gjennomført» bør skilles visuelt

**Kildekontrollert, ikke ny interaksjonstest:** Alle økter hoppet over gir samme grønne hake på uken som alle gjennomført, fordi `completed + skipped == total` styrer ikonet.

**Anbefaling:** Nøytral status «Uken avsluttet – 0 av 3 gjennomført», mens grønn gjennomføringsstatus reserveres for faktisk gjennomført. Bruk samme skille for blokker og mål.

**Kode:** `WeekCard` i `components/screens/goal-detail-screen.tsx`.

## Anbefalt rekkefølge

1. Etabler én felles løperstatus med datakvalitet og kjent/ukjent treningsgrunnlag.
2. Rett volumrekkefølge, frekvenshåndheving og sluttvalidering etter konkurranser og øktfordeling.
3. Skill justering av aktiv blokk fra generering av neste blokk.
4. Rett registreringene: øktmatching, personlige rekorder og aktivitetsfiltrering.
5. Gjør fart, prognoser og coachforklaringer konsistente med faktisk datagrunnlag.
6. Utvid deretter nybegynner- og proffopplevelsen med henholdsvis løp/gange/tid og treningsdager/doble økter.

Videre visuelle endringer bør støtte disse tilstandene: tydelig datagrunnlag, tydelig planperiode og entydige statuser. En ny estetisk omlegging er mindre viktig nå.
