/** Canonical public body for Meta Data Handling (government / public-authority requests). */
export const GOVERNMENT_DATA_REQUEST_POLICY_SLUG = "government-data-request-policy";

export const GOVERNMENT_DATA_REQUEST_POLICY_TITLE =
  "Government & Public Authority Data Request Policy";

export const GOVERNMENT_DATA_REQUEST_POLICY_BODY = `# Government & Public Authority Data Request Policy

**Effective date:** 13 September 2026  
**Entity:** Lumera Solutions LLP (“Lumera”, “we”)  
**Public URL:** https://www.mylumera.in/government-data-request-policy  
**Designated Compliance Officer:** ravee@lumer.me  

Lumera provides clinic software that may process personal data of patients, clinicians, and clinic staff, including data received through WhatsApp Cloud API and Facebook Login. **Lumera is not a certified Meta Tech Provider.** We do not grant any government or public authority bulk, direct, or unmediated access to user personal data.

This policy is binding on all Lumera personnel, contractors, and subprocessors acting on our instructions. No employee may disclose user personal data to a government or public authority except as set out below.

---

## Required Legal Review

Every incoming request from a government, court, regulator, law-enforcement agency, or other public authority for user personal data must be reviewed by Lumera’s Designated Compliance Officer **before** any data is searched, extracted, or disclosed.

**Operating procedure**

1. **Intake.** The recipient immediately forwards the request, unaltered, to **ravee@lumer.me** with the envelope, attachments, and the date and channel of receipt. The recipient does not acknowledge the merits of the request, search production systems, or share data.
2. **Identity and authority check.** The Designated Compliance Officer verifies the issuing body, the identity of the requesting officer, the statutory or judicial instrument relied upon, territorial jurisdiction, and service on Lumera (or on the relevant clinic tenant, if Lumera is only the processor).
3. **Legal validity check.** Counsel (internal or external) reviews whether the instrument is valid on its face, sufficiently specific, legally binding on Lumera, and consistent with Indian law (including the Digital Personal Data Protection Act, 2023, applicable criminal procedure, the Information Technology Act, 2000, and medical-confidentiality duties) and with Meta Platform Terms where WhatsApp or Facebook Login data is in scope.
4. **Written decision.** No disclosure proceeds without a written “produce / challenge / reject / notify-tenant” decision signed by the Designated Compliance Officer. Emergency life-and-safety exceptions (below) still require a written post-hoc review within 24 hours.
5. **Clinic-controller cases.** Where the clinic tenant is the controller of patient clinical records, Lumera does not treat a request served only on the clinic as a request served on Lumera, and does not produce tenant-controlled records unless legally compelled as processor or directed by the tenant in writing.

**Emergency exception.** If a request credibly asserts an imminent threat to life or physical safety and delay would cause serious harm, the Designated Compliance Officer may authorise a narrowly scoped disclosure and must complete the full legal review and record within 24 hours.

---

## Challenging Unlawful Requests

Lumera will challenge, object to, or contest any government or public-authority request that is unlawful, invalid, lacking proper jurisdiction, or overly broad.

**We will contest a request when, among other grounds:**

- It is not issued by a competent authority, is unsigned, undated, or not duly served.
- It is not legally binding on Lumera Solutions LLP (for example, it is addressed to the wrong entity, or it is a foreign order without a valid Indian process such as a mutual legal assistance channel).
- It is overly broad, fishing, or not particularised as to the data subject, time period, systems, or data categories.
- It seeks data Lumera does not control or does not hold.
- It would require disclosure of personal or health data in a manner inconsistent with Indian law or with Meta Platform Terms for WhatsApp / Facebook Login data.
- It seeks encryption keys, bulk dumps, or standing access to Lumera systems.
- A gag or non-disclosure clause is itself unlawful or overreaching.

**How we challenge**

- We may seek clarification, narrowing, a subpoena or court order in proper form, or additional legal process before producing anything.
- We may file objections, applications, or appeals before the issuing authority or a competent court, including where necessary to protect user rights under the DPDP Act.
- We notify the affected user or clinic tenant of the request **unless** legally prohibited from doing so. If a non-disclosure obligation appears overbroad, we challenge that restriction as well.
- We do not waive legal privileges or Meta Platform confidentiality obligations except to the minimum extent a valid order requires.

A request is not complied with while a good-faith challenge is pending, except where a court has directed interim production and we have documented that direction.

---

## Data Minimization

If disclosure is legally mandated after the review in **Required Legal Review**, Lumera discloses **only the absolute minimum personal data necessary** to satisfy the request — nothing more.

**Operating rules**

- Produce only the specific data subjects, fields, and time window identified in the valid instrument, after it has been narrowed where we successfully challenged scope.
- Prefer identifiers and message metadata over message content; prefer message content over clinical notes; never produce unrelated patients, full database exports, credentials, encryption keys, or access to live systems.
- Redact or withhold data of third parties, minors, and clinical information that is not strictly necessary to meet the order.
- Do not create new derived profiles, analytics, or “enhanced” dossiers for the requester.
- WhatsApp Cloud API and Facebook Login data are produced only if they are both (a) actually stored by Lumera and (b) expressly within the four corners of the valid instrument.
- Where the clinic is the controller, Lumera’s production as processor is limited to what Lumera holds in that capacity and what the instrument lawfully requires of Lumera.

If a request can be answered with a confirmation that no matching records exist, we provide that confirmation and no personal data.

---

## Documentation & Record-Keeping

Lumera logs and retains a complete file for every government or public-authority request for user personal data, whether we produce data, challenge the request, or reject it.

**Each file must record:**

- Date, time, and channel of receipt, and the Lumera person who received it.
- Identity of the requesting authority and officer, reference numbers, and the legal instrument (copy retained).
- Data subjects or categories potentially in scope, as described in the request.
- All internal actors involved (intake, engineering, clinic-success, Designated Compliance Officer) and all external actors (counsel, the authority, the clinic tenant, Meta if notification is required).
- Legal reasoning for produce / challenge / reject, including statutes or orders relied upon and any emergency exception.
- What was disclosed, if anything: data categories, volume, format, date of production, and the recipient.
- User or tenant notices sent, or the legal basis for not notifying.
- Outcome, including objections filed and final disposition.

**Retention and access.** Request files are retained for at least **seven (7) years**, or longer if a related proceeding is pending, and are stored with access limited to the Designated Compliance Officer and counsel. They are not used for product analytics or advertising.

**Reporting.** The Designated Compliance Officer reviews this log at least annually. Material incidents are reported to clinic tenants where legally permitted, and to Meta where Platform Terms require notice.

---

### Contact for legal process

Serve or email requests to **Lumera Solutions LLP**, Designated Compliance Officer, **ravee@lumer.me**. Informal or verbal demands are not sufficient legal process.

Related public documents: [Privacy Policy](https://www.mylumera.in/privacy-policy) · [Terms of Service](https://www.mylumera.in/terms-of-service) · [Data Deletion Instructions](https://www.mylumera.in/data-deletion-instructions)
`;
