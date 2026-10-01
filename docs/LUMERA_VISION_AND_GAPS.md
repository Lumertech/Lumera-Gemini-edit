# Lumera Health — Product Vision, Capability Map, and Competitive Gaps

**Ground truth:** `main` @ `ab08ac2` (2026-09).  
**Scope:** Read-only inventory of this repo (`Lumertech/Lumera-Gemini-edit`). No product features implemented.  
**Audience:** Founder / product lead. Use this as a 90-day action list, not a strategy deck.

**How to read this:** Lumera already *looks* like an India-first ambulatory OS. Most of the clinician suite is a high-fidelity sandbox: screens exist, SQLite exists, APIs exist — but the daily clinical write path (queue, chart, Rx, bill) still lives in React state and `src/data/clinicalData.ts` mocks. That single fact explains most of the P0s.

---

## 1. Product vision (inferred)

Lumera wants to be the **AI clinical operating system for Indian OPD and polyclinic practices**: a WhatsApp-first receptionist that books and tokens patients, an ambient multilingual scribe that turns Hinglish consults into SOAP + ICD-10 + FHIR, a specialty Smart Rx studio (physio through cardiology) that prints/signs and dispatches PDFs on WhatsApp, GST/UPI billing, ABHA/ABDM M1–M3 + DHIS ₹20/txn incentives, and a platform-admin CMS for lumer.me. The ICP is the interrupt-driven Indian doctor who still answers the phone, types Rx by hand, and fears missing after-hours calls — not a US hospital system. Copy, seed data, and flows are unambiguously India: +91, Kolkata letterhead, MCI numbers, GSTIN, UPI, Aadhaar OTP, Hindi/Tamil/Telugu/Marathi/Bengali, OPD rooms, token queues, Jan Aushadhi (claimed), Meta WABA, NHA DHIS.

**What it currently delivers:** a convincing *demo* of that OS (landing + login + clinician suite + admin CMS + ABDM/WhatsApp simulators) on a single SQLite file, with Gemini-backed SOAP/copilot when `GEMINI_API_KEY` is set. It does **not** yet deliver a clinic that can go live: new registrations inherit or share the seeded Vikram Malhotra workspace, consults vanish on refresh, WhatsApp/ABDM/Meta are local stubs, and several marketing claims (certified ABDM, live Meta Tech Provider, Jan Aushadhi, 24/7 voice receptionist) are not backed by production integrations.

---

## 2. Current capability map (by domain)

Legend: **Real** = persisted + used by UI · **Partial** = API or UI exists but not wired end-to-end · **Demo** = in-memory / mock / simulated · **Absent** = not in this codebase · **Orphan** = implemented but not mounted.

### Auth, tenancy, identity

| Capability | Status | Evidence |
|---|---|---|
| Email/password login | **Real** | `POST /api/auth/login` in `server/api.ts`; scrypt in `server/password.ts`; httpOnly `lumera_sid` + optional JWT in `server/auth.ts` |
| WhatsApp OTP 2FA | **Demo** | OTP stored in `otp_verifications`; `dispatchWhatsAppOtpMessage` writes SQLite only — no Meta Cloud send. Non-production returns `demoOtp` to the client |
| `skipOtp` bypass | **Real (unsafe)** | Any client can POST `{ skipOtp: true }` and get a session (`server/api.ts` ~178–199). Demo buttons use this |
| Google/Facebook OAuth | **Demo** | `POST /api/auth/oauth` trusts client-supplied `profile.email` — no token exchange |
| Practice registration | **Partial** | `POST /api/auth/register-practice` creates `tenants` + `users` + doctor + 14-day trial. Onboarding surface is **not rendered** on `main` (see §4 / PR #9) |
| Roles | **Partial** | `UserRole`: doctor, receptionist, polyclinic_admin, CLINIC_ADMIN, super_admin, patient. Sidebar matrix in `ROLE_VISIBLE_VIEWS`. Sidebar also lists `nurse` / `lab_technician` / `pharmacist` — **no such roles in the type or seed** |
| Multi-tenant isolation | **Partial / broken** | `users.tenant_id` and `tenants` exist. Patients, appointments, prescriptions, doctors have **no `tenant_id`**. `GET /api/patients` and `GET /api/appointments` are unauthenticated and return the whole table |
| Firebase | **Orphan** | `src/lib/firebase.ts`, `src/middleware/auth.ts` — unused by Express |
| JWT secret | **Unsafe default** | `JWT_SECRET \|\| "lumera-medical-suite-jwt-secret-key-2026"` |

Demo accounts (seeded, password `Lumera@2026`): `admin@lumera.me`, `doctor@lumera.me` (Dr. Vikram Malhotra), `patient@lumera.me`, `reception@lumera.me`.

### Onboarding

| Capability | Status | Evidence |
|---|---|---|
| Wizard UI | **Orphan on main** | `src/pages/OnboardingWizard.tsx` collects specialty, MCI-style `regNumber`, fee, OPD room/timing, `practiceType`. `POST /api/auth/complete-onboarding` persists doctor row |
| Post-auth routing | **Broken on main** | `homeSurfaceForRole` returns `"onboarding"` when `onboardingCompleted === false`, but `App.tsx` never renders `OnboardingWizard` — falls through to `LandingPage`. Demo login also sets `loginNext: "app"`, skipping the flag |
| Clean empty clinic | **Absent on main** | New clinics still see seeded doctors/patients/appointments (ClinicianApp boots from `MOCK_*`) |

**PR #9** (`cursor/onboarding-session-nav-3a52`, open, +1211/−737) changes this: mounts the wizard, forces onboarding, adds digital signature / slot duration / Rx template, welcome dashboard, and **returns empty patients/appointments for non-demo tenants**. That is a demo-workspace *gate*, not true table-level tenancy (patients still have no `tenant_id`). Worth merging, then finishing isolation.

### Appointments / OPD

| Capability | Status | Evidence |
|---|---|---|
| Token queue + vitals | **Demo** | `QueueBoard.tsx` — Waiting → Vitals → In Consultation → Completed; vitals modal; token call chime. State in `ClinicianApp` `useState(MOCK_APPOINTMENTS)`. Status/vitals updates **not POSTed** |
| Reception + walk-in | **Demo + ABHA sandbox** | `Reception.tsx` registers into parent state; Aadhaar OTP hits local ABDM stub (`OTP 123456`) |
| Calendar (day/week/month) | **Demo** | `AppointmentsCalendar.tsx` — book + follow-up presets (+7/+14/+30). No conflict/leave/recurrence |
| TV kiosk + TTS | **Demo** | `WaitingRoomKiosk.tsx`; parent walk-in generates random UHID. Prop/signature mismatch risk across devices |
| Appointment APIs | **Partial** | `GET /api/appointments` (unauthenticated, unused by ClinicianApp). Write path: WhatsApp `book_appointment` only. **No REST create/update/cancel** |
| Reminders / waitlist / teleconsult | **Absent** | CMS copy claims 95% no-show reduction; no reminder scheduler |

### Patients / EMR

| Capability | Status | Evidence |
|---|---|---|
| Patient list / UHID / ABHA badges | **Demo** | `MOCK_PATIENTS` (7 people). `GET /api/patients` exists and is unused by the EMR shell |
| Chart (problems, allergies, meds, immunizations, visit timeline) | **Absent as a product** | Types have `allergies` / `chronicConditions` arrays; no longitudinal encounter store. SOAP notes are React state only (`activeSoapData`) |
| Patient create/update API | **Absent** except `PATCH /api/patients/:id/abha` (also unauthenticated) |
| Patient portal | **Orphan** | In-app `PatientPortal.tsx` is a tab inside ClinicianApp. Standalone `PatientPortalApp.tsx` is never mounted; `surface === "portal"` falls through to landing |
| IPD / OT / discharge / nursing | **Absent** | DHIS can *simulate* a discharge transaction |

### Rx / clinical documentation

| Capability | Status | Evidence |
|---|---|---|
| Smart Rx Studio | **Demo UI, partial persist** | `PrescriptionWriter.tsx` — complaints, diagnosis/ICD-10, Indian brand search, labs, advice, print, “digital sign”, WhatsApp translate + `POST /api/whatsapp/send-rx`. Finalize saves to `prescriptions[]` in memory |
| Indian drug catalog | **Static, ~40 SKUs** | `INDIAN_DRUG_DATABASE` in `clinicalData.ts` (Dolo, Augmentin, Telma, Glycomet, …). Not CDSCO/1mg-scale; **no Jan Aushadhi finder** despite landing claim |
| Specialty modules | **Demo UI (real depth)** | Physio (exercises, procedures, packages, progress), Cardio, Derma, Peds, Ortho, Ophtho, Dental, Gynae under `src/components/specialty-rx/` |
| Drug-interaction “safety check” | **Partial** | `POST /api/gemini/safety-check` — Gemini or rule fallback; unauthenticated |
| Ambient scribe | **Partial AI, no mic** | `AmbientAIStudio` / `CompactAmbientScribe` play **hardcoded** Hinglish/Marathi/… transcripts. **Zero** `getUserMedia` / `MediaRecorder`. SOAP via `POST /api/gemini/generate-soap` (unauthenticated). Notes not written to DB |
| Lab OCR & trends | **Demo** | `LabReportAnalyzer.tsx` — `MOCK_LAB_REPORTS`, `setTimeout` “OCR”, hardcoded Thyrocare-style series. No Vision API, no LIS |
| FHIR / SNOMED | **Library + samples** | `server/fhir.ts` builds NRCeS-ish R4 bundles. Used by ABDM sample/transfer endpoints, not by every signed Rx |
| eRx registry / controlled drugs | **Absent** | |

### Billing / payments / pharmacy

| Capability | Status | Evidence |
|---|---|---|
| GST invoice UI | **Demo** | `BillingManager.tsx` — HSN/SAC (999312 consult, 300490 pharmacy), GST-exempt healthcare copy, UPI/Cash/Card/Insurance, print. Invoice numbers `INV-2026-xxxx` client-side |
| Payment gateway | **Absent** | `types.ts` mentions Razorpay; no SDK, no order API. UPI ID hardcoded `lumerahealth@icici` |
| Pharmacy batches / packages | **Demo** | `MOCK_PHARMACY_BATCHES`, `MOCK_THERAPY_PACKAGES` — no stock decrement, no expiry alerts |
| Invoice table | **Absent** | No `invoices` in SQLite |
| Tally/Zoho/GST filing | **Absent** | |
| Insurance TPA / pre-auth | **Absent** (payment mode label only) | |

Admin **subscriptions** (platform SaaS, not clinic billing) **are** persisted: trial ₹0 / starter ₹999 / professional ₹2499 / clinic ₹4999 /mo in `subscriptions`. No Razorpay/Stripe checkout; admin patches status by hand. Landing has **no pricing page**.

### Staff / polyclinic

| Capability | Status | Evidence |
|---|---|---|
| Doctor roster | **Partial** | SQLite `doctors` CRUD. ClinicianApp **does** `GET /api/doctors` (only clinical list hydrated from API). Individual practice hides Team in sidebar |
| Clinic team logins | **Partial** | `ClinicTeamManager.tsx` + `/api/clinic/team` — create doctor/receptionist, reset password. New users **not always assigned `tenant_id`**. **PR #4** (draft) is an earlier version of this idea |
| Polyclinic manager | **Demo stats** | `PolyclinicManager.tsx` — specialty filter + hardcoded revenue/footfall; `DoctorProfileModal` edits fee/OPD/HPR |
| Branches | **Orphan admin UI** | Table + `/api/branches` exist; `AdminBranches.tsx` **not mounted** in `AdminShell`. No live multi-location routing |
| Shifts / leave / duty roster | **Absent** | |
| Reception vs doctor permissions | **Partial** | Receptionist cannot open Ambient/Rx via sidebar, but APIs are coarse |

### Admin CMS / platform

| Capability | Status | Evidence |
|---|---|---|
| Super-admin shell | **Real** | `AdminShell.tsx`: overview, ABDM/DHIS, Meta Tech Provider, users, subscriptions, website CMS, policies, media, audit |
| Landing CMS | **Partial** | SQLite `cms_settings` / `cms_sections`. `LandingPage.tsx` fetches `/api/public/site` but **hardcodes** hero/benefits/testimonials; CMS pains/features/personas are **not rendered** |
| Policy pages | **Real** | `/privacy-policy`, `/terms-of-service`, `/data-deletion-instructions` via `PolicyPage` + `cms_policies` |
| Audit log | **Partial** | Admin actions only (`audit_logs`). No clinical access audit (who opened which chart) |
| Orphan admin modules | **Orphan** | `AdminPeople`, `AdminSettings`, `AdminBranches` |

Open PRs **#1** (landing+CMS origin), **#3** (lumer.me brand + admin nav) are largely already on `main`. **#6** (light-mode landing) is draft cosmetic.

### Integrations

| Capability | Status | Evidence |
|---|---|---|
| Gemini SOAP / copilot / translate / voice-bot / safety | **Partial** | Real Google calls when key set; else local fallbacks. **No auth** on `/api/gemini/*` |
| WhatsApp inbox + bot | **Demo / local** | SQLite conversations/messages; `POST /api/whatsapp/send` does not call Graph API. Several UI paths mismatch server (`/outbound-events` vs `/outbound/events`, `/voice-note` vs `/voice-process`) |
| Meta Tech Provider console | **Demo** | WABA connect/disconnect, templates auto-APPROVED, `simulate-embedded-signup`, fake `wamid`. Webhook *shape* is real if Meta posts |
| ABDM v3 | **Local sandbox** | `server/abdm.ts` — fake bridge JWT, hardcoded Aadhaar OTP, in-memory consent store, generated FHIR, ECDH demo. `ABDM_GATEWAY_URL` unused |
| DHIS meter | **Real against SQLite** | Seeded ~78/100 txns; simulate button; ₹14 clinic / ₹6 Lumera copy. No PFMS |
| PSTN / Exotel / telephony | **Absent** | `VoiceBotAssistant` is a Gemini chat with TTS |
| LIS/RIS/PACS / HL7 | **Absent** | |
| Postgres / Drizzle | **Orphan** | `src/db/schema.ts` is a journal-style `users`/`entries` scaffold — **not** the clinical schema |

### Compliance / security

| Capability | Status | Evidence |
|---|---|---|
| Marketing claims | **Copy only** | Landing: “ABDM M1/M2/M3 certified (NHA)”, “Official Meta WhatsApp Tech Provider”, “256-bit encryption / DPDP Act / HIPAA-grade” |
| Encryption at rest | **Absent** | SQLite `data/lumera.db` plaintext PHI (patients, Rx, WhatsApp bodies, `meta_access_token`) |
| PHI API auth | **Fail** | Unauthenticated `GET /api/patients`, `GET /api/appointments`, `PATCH .../abha`, all Gemini routes |
| DPDP data-subject flow | **Stub** | Meta data-deletion returns a confirmation code and “COMPLETED”; no purge of clinical tables |
| Session | **Partial** | HttpOnly cookie + Bearer; 7-day sessions. Hardcoded JWT fallback |
| Clinical consent for recording | **Absent** | Ambient UI has no consent artefact |
| Tests / CI | **Absent** | No `*.test.*`, no `.github/workflows`, `package.json` name still `"react-example"` |

### Mobile / offline / analytics

| Capability | Status | Evidence |
|---|---|---|
| Native / PWA / offline chart | **Absent** | SPA, in-memory EMR; refresh loses queue/Rx/bills |
| Deep links / real URLs | **Partial** | Surface state machine, not React Router (dependency is unused). Only legal paths `pushState` |
| Practice analytics | **Absent** | Polyclinic “revenue” is hardcoded. Recharts used in lab trends mock. Admin MRR is SaaS-operator stats, not clinic dashboards |
| Patient mobile app | **Absent** | WhatsApp is the intended channel |

---

## 3. Architecture snapshot

```
Browser SPA (React 19 + Vite + Tailwind 4)
  surfaces: landing | login | app | admin | legal
            (portal, onboarding declared — not rendered on main)
  ClinicianApp: MOCK_PATIENTS / MOCK_APPOINTMENTS in useState
                doctors: GET /api/doctors
                Rx / SOAP / invoices: component state

Express (tsx server.ts, port 3000)
  /api          → server/api.ts     auth, CMS, doctors, patients GET
  /api/whatsapp → server/whatsapp.ts inbox, PDF HTML, emr-action
  /api/meta     → server/meta.ts     WABA stubs + webhook shape
  /api/abdm,/v3 → server/abdm.ts     ABHA/DHIS/FHIR sandbox
  /api/gemini/* → server.ts          unauthenticated Gemini

SQLite  data/lumera.db   ← runtime source of truth
Postgres src/db/*        ← unused AI Studio leftover
```

**Stack:** React 19, Vite 6, Express 4, `node:sqlite`, Drizzle/pg unused, `@google/genai`, cookie-parser, jsonwebtoken, multer, lucide, motion, recharts. ~73 TS/TSX modules, ~26k lines.

**Tenancy model today:** one shared clinic database with a `tenants` table bolted on for registration, DHIS, and Meta templates. Clinical rows are global. Demo seed is a Kolkata “Lumera Healthcare & Polyclinic Institute” with 9 doctors / 7 patients / 6 appointments.

**Key modules (UI):** `ClinicianApp` shell + Sidebar/Navbar; OPD (`Reception`, `QueueBoard`, `AppointmentsCalendar`, `WaitingRoomKiosk`); clinical (`PrescriptionWriter`, `specialty-rx/*`, `AmbientAIStudio`, `LabReportAnalyzer`, `GeminiAssistant`); engagement (`WhatsAppAssistant`, `VoiceBotAssistant`); money (`BillingManager`); org (`PolyclinicManager`, `ClinicTeamManager`); admin (`AdminShell` + CMS/users/subs/Meta/DHIS).

**Docs:** there is **no README**. Product intent lives in `metadata.json`, `index.html` meta, `LandingPage.tsx`, and CMS seed in `server/db.ts`.

---

## 4. Gaps vs world-class ambulatory / EMR / PM

Comparators used as the bar (India + global ambulatory, not inpatient Epic): **Practo Ray / Healthplix / Cliniceo-class India clinic OS**, **Cliniko**, **SimplePractice**, **DrChrono**, **Athena / Epic Ambulatory** (for “what credibility looks like,” not feature-clone).

### P0 — blocking credibility (do not sell this as live clinic software)

**P0-1. Clinical work does not persist.**  
*Missing:* Durable write APIs and UI hydration for patients, appointments/queue/vitals, prescriptions, SOAP, invoices.  
*Why it matters:* A doctor who books a token, records vitals, signs an Rx, and collects ₹600 must see it tomorrow. Practo Ray / Cliniko / Healthplix treat this as table stakes.  
*Today:* `ClinicianApp` initializes from `MOCK_PATIENTS` / `MOCK_APPOINTMENTS`; `handleSavePrescription`, `handleUpdateAppointmentStatus`, `handleAddNewToken`, `handleBookAppointment` only `setState`. SQLite has those tables and seeds; the EMR mostly ignores them. Refresh = empty day.

**P0-2. No real tenant isolation / new clinics inherit the demo.**  
*Missing:* `tenant_id` (or equivalent) on patients, appointments, prescriptions, doctors; enforced on every query.  
*Why it matters:* PHI leakage across clinics is a company-ending event in healthcare; also the first thing a founder sees when they “register a practice” and land in Dr. Vikram’s queue.  
*Today:* `GET /api/doctors|patients|appointments` are global. Unauthenticated patient list. **PR #9** hides seed data from non-demo users (empty arrays) but still does not column-scope PHI.

**P0-3. Auth and PHI endpoints would fail any security review.**  
*Missing:* Mandatory auth on clinical + Gemini routes; no client `skipOtp`; real OAuth; rotated secrets; no “pick any doctor” OTP fallback.  
*Why it matters:* DPDP + clinical buyers’ IT checklists. Athena/Epic-class buyers will not pass a POC with open patient dumps.  
*Today:* `skipOtp` on login; OAuth trusts email from the browser; `GET /api/patients` and `GET /api/appointments` have no `requireAuth`; `PATCH /api/patients/:id/abha` is open; `/api/gemini/*` is open; JWT fallback secret hardcoded; WhatsApp OTP verify can `LIMIT 1` a random doctor if phone lookup fails (`server/api.ts` ~400).

**P0-4. Onboarding and patient portal are disconnected on `main`.**  
*Missing:* Mount `OnboardingWizard` and `PatientPortalApp` in `App.tsx`; URL + role routing that cannot be skipped.  
*Why it matters:* First-run experience is the product. SimplePractice/Cliniko win on “empty clinic, 5-minute setup, first appointment.” Patient portal is how follow-ups and bills get paid.  
*Today:* Surfaces `"onboarding"` and `"portal"` exist in `NavigationContext`; `SurfaceRoot` never renders them. Wizard and portal apps are orphans.

**P0-5. Flagship differentiators are simulators, while marketing says certified/live.**  
*Missing:* Live mic transcription; Meta Cloud send; ABDM gateway; honest “sandbox” labeling on the landing page.  
*Why it matters:* India clinic software is a trust market (NHA, Meta App Review, DPDP). Claiming “100% ABDM M1–M3 Ready / Official Meta Tech Provider / HIPAA-grade” while using local OTP `123456` and fake `wamid`s will burn the first 10 design-partner clinics and fail Meta/NHA review.  
*Today:* Ambient: hardcoded transcripts, no `getUserMedia`. WhatsApp outbound: SQLite only. ABDM: in-process stub, `ABDM_GATEWAY_URL` unused. Landing still says certified. Jan Aushadhi listed on landing, **zero** code. Voice receptionist: no PSTN. Lab OCR: `setTimeout`.

**P0-6. No production data plane.**  
*Missing:* Postgres (or equivalent) as the clinical store, backups, migrations that match the EMR, encryption at rest, no PHI in git-adjacent `data/lumera.db`.  
*Why it matters:* SQLite + WAL on one VM is a demo. Cliniko/Athena run HA SQL with PITR. Dual schema (`server/db.ts` vs unused Drizzle `users/entries`) will fork the team.  
*Today:* Runtime is `node:sqlite`. `src/db/schema.ts` is unrelated. No tests, no CI, no README, package name `react-example`.

---

### P1 — competitive parity (required to replace Practo Ray / Healthplix / Cliniko for an Indian OPD)

**P1-1. Appointment OS:** create/cancel/reschedule with conflict detection, doctor-day templates, OPD hours from onboarding, waitlist, SMS/WhatsApp reminders, no-show tracking. *Today:* calendar UI + in-memory book; CMS claims 95–96% no-show reduction with no scheduler.

**P1-2. Longitudinal chart:** problem list, allergy/meds recon, visit timeline, signed notes with amend/audit, attachments. *Today:* per-visit Rx form + SOAP blob in RAM.

**P1-3. Rx that a chemist can trust:** 10k+ Indian SKU formulary (or 1mg/CIMS license), generic/Jan Aushadhi swap, schedule H1/X warnings, printable pad with real doctor signature + clinic letterhead from tenant settings, persisted `prescriptions` + PDF. *Today:* ~40 hardcoded brands; signature is a UI toggle; send-rx is a partial insert.

**P1-4. Billing that closes the day:** persisted invoices, UPI QR via a PSP (Razorpay/Cashfree), receipt on WhatsApp, day-end report, GSTIN from tenant not `19AABCL8899K1Z5` seed, refunds. *Today:* `BillingManager` local state; Razorpay is a type union.

**P1-5. WhatsApp as the real front door:** Embedded Signup, template approval, actual Graph send, inbound webhook → book/token/Rx, OTP that reaches the phone. *Today:* rich inbox UI on SQLite; path mismatches between UI and server; Meta console auto-approves templates.

**P1-6. Working patient surface:** book, see token/ETA, Rx PDFs, pay link, ABHA-linked profile — WhatsApp *or* `/portal`. *Today:* portal orphan; WhatsApp booking writes appointments only via `emr-action` and is not the clinician calendar’s source of truth.

**P1-7. Team + locations:** tenant-scoped invites, receptionist vs nurse vs pharmacist actually in the role enum, branch as a first-class filter on queue/calendar. *Today:* team API exists; branches orphan; extra roles in sidebar comments only.

**P1-8. ABDM that is sandbox-true, then production-true:** registered HIP/HIU in NHA sandbox, real Aadhaar OTP, consent artefacts stored, M2/M3 push of signed encounters — labeled “sandbox” until certified. *Today:* impressive FHIR builders + DHIS meter on fake events.

**P1-9. URL routing and multi-device queue:** shareable `/app/queue`, kiosk on a TV that is not the same React tree’s memory. *Today:* surface state; kiosk cannot sync.

**P1-10. Operator hygiene:** README, env contract, `JWT_SECRET` required, `skipOtp` dev-only, tests on auth + tenant + Rx sign, CI. *Today:* none.

---

### P2 — delight / differentiation (after P0/P1, this is the actual Lumera wedge)

**P2-1. Real ambient scribe** with recording consent, streaming ASR (Hindi+English first), clinician edit + sign, auto ICD-10 — this is the 3.5 hrs/day claim. Competitors (Healthplix AI, Suki-like, new India scribes) are racing here.

**P2-2. Specialty toolbars that save clicks** — physio exercise plans and dental/gynae modules are already ahead of Practo Ray if they persist. Productize as “specialty packs.”

**P2-3. Voice receptionist on a real number** (Exotel/Knowlarity/Twilio + Indian STT) — the landing’s #1 promise. Cliniko does not do this; Practo’s call products are the rival.

**P2-4. DHIS rupee meter that files** — unique India wedge vs Cliniko/SimplePractice. Only valuable after ABDM writes are real.

**P2-5. Lab OCR that is Gemini Vision + trend-in-chart**, not a mock Thyrocare PDF.

**P2-6. Offline/PWA for bad clinic Wi-Fi** (queue + Rx draft sync). Epic/Athena assume always-on; India OPD does not.

**P2-7. Clinic analytics:** patients/day, collection, no-show, specialty mix — PolyclinicManager already fakes this.

**P2-8. Teleconsult link** (WhatsApp video or Daily/Zoom) on the appointment type that already exists in the UI (`type` field).

---

## 5. Recommended 90-day roadmap (12 bets, ordered)

Assume a small team. Sequence is “can a real clinic run Monday OPD without losing data or leaking PHI,” then “WhatsApp + pay,” then “AI that is not a demo.” Do not start Meta Tech Provider polish or landing redesign until P0 is closed. Merge **PR #9** early; treat **#2/#5/#7/#8** (preview listen fixes) as infra, not product.

| # | Bet | Outcome in 90 days | Depends on |
|---|---|---|---|
| 1 | **Persist the OPD loop** — tenant-scoped CRUD for patients, appointments (token/status/vitals), prescriptions; ClinicianApp hydrates from API, not `MOCK_*` | Refresh-safe queue → vitals → Rx → done | Schema `tenant_id` |
| 2 | **Lock PHI** — `requireAuth` on patients/appointments/abha/Gemini; delete `skipOtp` except `NODE_ENV!==production`; require `JWT_SECRET`; fix OTP doctor `LIMIT 1` fallback; stop returning OTP in JSON | Passes a 1-hour security skim | — |
| 3 | **Ship onboarding as the empty clinic** — merge PR #9, mount portal too, stop demo-login from skipping wizard for real users; welcome CTAs write to API | First-run ≠ Vikram Malhotra | 1, 2 |
| 4 | **Honest sandbox labeling** — landing/admin: “NHA sandbox / Meta simulator” until credentials exist; remove Jan Aushadhi / HIPAA / “certified” until true | Trust with design partners | — |
| 5 | **Tenant letterhead** — clinic name, GSTIN, UPI, seal, signature from tenant/doctor, used on Rx PDF + invoice | Printouts look like that clinic | 3 |
| 6 | **WhatsApp OTP that actually arrives** — one Graph API send path for login OTP + Rx PDF (even if templates are limited) | 2FA and Rx dispatch are real | Meta WABA |
| 7 | **Appointment reminders + WhatsApp book → same calendar** | Defensible vs Practo on no-shows | 1, 6 |
| 8 | **UPI collect** — Razorpay/Cashfree order + webhook marks `appointments.is_paid` / invoice row; WhatsApp receipt | Front desk can close cashless | 1 |
| 9 | **Ambient v1: real mic** — MediaRecorder → Gemini (or ASR) → SOAP attached to encounter; consent checkbox | Differentiator stops being fake | 1 |
| 10 | **Postgres + backups** — migrate `server/db.ts` schema; drop unused Drizzle journal; daily backup | Not a toy DB | 1 |
| 11 | **Patient portal v0** — logged-in patient sees own Rx + next appointment (mount `PatientPortalApp`, filter by user) | Completes the role matrix | 1, 3 |
| 12 | **ABDM sandbox registration** — real gateway session, one M2 prescription bundle for a test ABHA; DHIS meter counts those rows only | India-compliance story becomes true-sandbox | 1, 10 |

**Explicitly not in 90 days:** Epic-class US billing, IPD/OT, LIS/PACS, native mobile apps, light-mode marketing (PR #6), wellness/spa personas in CMS seed, auto-approved Meta template theatre.

**Design-partner test (definition of done):** a new clinic registers on WhatsApp OTP, completes onboarding, adds one patient, runs a 10-token OPD, signs an Rx that survives refresh, collects UPI, and does not see any other clinic’s patients.

---

## Appendix A — Open PRs vs this picture

| PR | Branch | Effect on this analysis |
|---|---|---|
| **#9** (ready) | `cursor/onboarding-session-nav-3a52` | **Material.** Wires wizard, welcome dashboard, sidebar regroup, demo vs empty workspace. Does **not** add patient/appointment write APIs or column-level tenancy. Merge, then bet 1 |
| **#4** (draft) | `cursor/clinic-team-mgmt-735e` | Team UI largely already on `main`. Low incremental value |
| **#3** (draft) | `cursor/admin-lumer-brand-735e` | Brand/admin split largely on `main` |
| **#1** (draft) | `cursor/landing-admin-cms-52e3` | Origin of CMS; superseded by `main` |
| **#6** (draft) | `cursor/light-mode-landing-5f3f` | Cosmetic; do not prioritize |
| **#2, #5, #7, #8** | preview/listen/Windows bind | DevEx for Cursor preview; not product gaps |

## Appendix B — India-market specifics already in the code (keep)

These are the right bets for this ICP; they should survive the rewrite of the persistence layer:

- WhatsApp as the patient OS (OTP, booking, token, Rx PDF), not SMS/email-first
- OPD tokens, room numbers, split OPD hours (`09:00 AM - 01:00 PM, 04:00 PM - 07:00 PM`)
- ABHA / Aadhaar / HPR / HFR / DHIS ₹20
- GSTIN, HSN/SAC, UPI, ₹, GST-exempt healthcare invoicing
- Indian brand names and 1-0-1 frequency notation
- Regional languages on the landing and scribe samples
- Polyclinic vs individual practice type
- MCI-style registration on the pad

## Appendix C — Inventory of surfaces (main)

| Surface | Mounted? | Entry |
|---|---|---|
| Landing | Yes | `/` → `LandingPage` |
| Login / register | Yes | `/login` → `LoginPage` |
| Clinician EMR | Yes | `surface=app` → `ClinicianApp` |
| Admin CMS | Yes | `/admin` → `AdminShell` |
| Legal | Yes | `/privacy-policy`, `/terms-of-service`, `/data-deletion-instructions` |
| Onboarding | **No** | Wizard file exists |
| Patient portal app | **No** | `PatientPortalApp.tsx` exists; in-EMR tab only |

---

*Generated from a full-repo review of `main` plus diff/stat of open PRs. If a later merge of PR #9 lands, re-read §2 Onboarding and P0-2/P0-4 — the empty-workspace story changes; the persistence and security P0s do not.*
