# SANDBOX / DEMO accounts

Shared password for every seeded `@lumera.me` login: **`Lumera@2026`**.

This is a local / staging matrix. It is **not** production. ABDM paths are NHA sandbox — not certified.

| Email | Role | Practice type | Practice line | Specialty pack | Lands on |
|---|---|---|---|---|---|
| `admin@lumera.me` | super_admin | platform (polyclinic tenant) | Platform | — | Admin console |
| `receptionist@lumera.me` | receptionist | **individual** | Front desk | — | Reception (no Multispecialty chrome) |
| `reception@lumera.me` | receptionist | **individual** | Front desk | — | Reception (legacy alias) |
| `clinic.admin@lumera.me` | CLINIC_ADMIN | **polyclinic** (opt-in demo only) | Doctors & Clinics | General Medicine | Welcome / multi-specialty clinic home |
| `patient@lumera.me` | patient | individual | Patient | — | Patient portal |
| `doctor@lumera.me` | doctor | individual | Doctors & Clinics | General Medicine | OPD queue + GP Rx |
| `cardiology@lumera.me` | doctor | individual | Doctors & Clinics | Cardiology | Cardiology module |
| `dermatology@lumera.me` | doctor | individual | Doctors & Clinics | Dermatology | Dermatology module |
| `orthopedics@lumera.me` | doctor | individual | Doctors & Clinics | Orthopedics | Orthopedics module |
| `pediatrics@lumera.me` | doctor | individual | Doctors & Clinics | Pediatrics | Pediatrics module |
| `gynecology@lumera.me` | doctor | individual | Doctors & Clinics | Gynecology | Gynecology module |
| `ent@lumera.me` | doctor | individual | Doctors & Clinics | ENT | ENT intake + consult |
| `ophthalmology@lumera.me` | doctor | individual | Doctors & Clinics | Ophthalmology | Ophthalmology module |
| `dentist@lumera.me` | doctor | individual | Dentists | Dental Surgery | Odontogram / dental visit |
| `physio@lumera.me` | doctor | individual | Physiotherapists | Physiotherapy & Rehabilitation | Assessment + sessions (not Rx-first GP) |
| `therapist@lumera.me` | doctor | individual | Therapists | Psychiatry & Mental Health | Therapy session desk |
| `wellness@lumera.me` | doctor | individual | Wellness & Spas | Wellness & Spas | Salon/spa book (not a medical chart) |
| `consultant@lumera.me` | doctor | individual | Consultants | Consulting | Meetings / briefs / invoices |

Register / create-clinic first paint stays **Individual** (`DEFAULT_PRACTICE_TYPE`). `clinic.admin@lumera.me` is the single explicit Multi-specialty demo and does **not** change that default.

Every specialty doctor above is an **individual** practice login. They land the matching specialty pack (GP / physio / dental / therapy / wellness / consultant), not the generic Multispecialty welcome roster.
