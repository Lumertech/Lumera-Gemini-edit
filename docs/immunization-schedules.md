# Immunization schedules

Veterinary is a clinical module on the existing general-practice pack, the same way Pediatrics is a module and not a separate app. The animal is the patient. Species and breed are fields on that record. The owner is the existing emergency / guardian contact.

`users.specialty` stays a pack id (`gp`, `physio`, `dentist`, `spa_salon`, `therapist`, `consultant`). Admin user create and update still reject the word `veterinary` as a pack id. Clinic registration that chooses Veterinary stores pack `gp` and sets the doctor row to the Veterinary module.

Lumera charts are reminders. A doctor confirms every dose. The product does not give a vaccine by itself, and it does not send a WhatsApp due-dose message.

Catalog version: `2026.11.1` in `src/lib/immunizationSchedules.ts`. Each schedule also has its own source version. A clinic edit is stored separately and does not rewrite the cited rows.

Day anchors used to place due dates: 1 week = 7 days, 1 month = 30 days, 1 year = 365 days.

## Pediatric — IAP-ACVIP 2023 (clinic default)

Indian Academy of Pediatrics, Advisory Committee on Vaccines and Immunization Practices. Recommended Immunization Schedule (2023) and Update on Immunization for Children Aged 0 Through 18 Years. Indian Pediatrics. 2024;61:113-125. DOI 10.1007/s13312-024-3104-5. Table I.

https://www.indianpediatrics.net/feb2024/113.pdf

Birth through 18 years: BCG, OPV-0, hepatitis B, DTwP/DTaP, IPV, Hib, PCV (3+1), rotavirus, influenza through 5 years, typhoid conjugate (single dose, no booster in this table), MMR, hepatitis A, varicella, HPV (2 doses from 9 years for girls and boys), Tdap at 10 years, Td at 16–18 years.

Japanese Encephalitis is not in that routine table. The chart shows the UIP JE ages only after the clinic marks an endemic district.

Rotavirus dose 3 and hepatitis A dose 2 are optional because they depend on the product (2-dose rotavirus, live vs inactivated hepatitis A).

## Pediatric — India UIP / NIS (selectable per clinic)

Ministry of Health and Family Welfare. Routine Immunization Manual for Health Workers, 2024. National Immunization Schedule, Table 3.1 and the infant/child summary.

https://nccmis.mohfw.gov.in/document/RI_Manual_For_Health_Workers.pdf

BCG, hepatitis B birth dose, bOPV, pentavalent (DPT + Hep B + Hib), rotavirus, fractional IPV, PCV (2+1), MR, DPT boosters, Td at 10 and 16 years. JE only in selected districts.

Vitamin A and antenatal Td are in the government schedule and are not rows on this vaccine chart.

## Dogs and cats

World Small Animal Veterinary Association Vaccination Guidelines Group. 2024 guidelines for the vaccination of dogs and cats. Journal of Small Animal Practice.

https://wsava.org/wp-content/uploads/2024/04/WSAVA-Vaccination-guidelines-2024.pdf

Dogs: DHPPiL (DAPP + Lepto) at 8, 12 and 16 weeks, a 26-week dose, annual leptospirosis, and core DAP no more often than every 3 years. Anti-rabies at 12 and 16 weeks, then annual boosters.

Cats: FVRCP at 8, 12 and 16 weeks, a 26-week dose, then a recurring booster (annual by default). Anti-rabies on the same primary series and annual booster.

Deworming is an optional, non-vaccine row (every 2 weeks until 12 weeks, then about every 3 months). It is clinic practice, not a government schedule. The clinic can hide it.

Annual rabies is the India default because the country is rabies-endemic and many local programs expect a yearly booster. WSAVA says the interval follows local law and the product leaflet, and several vaccines have a longer licensed duration. The doctor in charge can change the interval on the clinic template. The leaflet and local rules win over this default.

## WhatsApp

The due-dose reminder hook in `src/lib/vaccineDueReminderHook.ts` is disabled. Approved templates in this product are appointment, follow-up, prescription, and queue messages. None of them is a vaccination-due reminder, so the hook does not send and does not submit a new Meta template.
