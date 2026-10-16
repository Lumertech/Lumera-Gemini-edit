# Patient health documents and consent

Android and web use the same clinic session. Bytes never go to public `/uploads`.

## Who can call these routes

`doctor`, `receptionist`, `CLINIC_ADMIN`, and `polyclinic_admin` in the session tenant. `super_admin`, `admin`, and `patient` receive **403** `{ "error": "Insufficient permissions", "code": "ROLE_DENIED" }` with no patient fields.

## List and search

`GET /api/patients?q=&limit=`

`q` matches name, phone (last-10 digits), UHID, ABHA number, or ABHA address inside the session tenant. Results are newest visit first.

## Chart and timeline

`GET /api/patients/:id/chart`

`{ patient, visits, prescriptions, timeline }`

`timeline` items, newest first: `visit`, `prescription`, `invoice`, `upload`, `consent`.

A receptionist prescription item is `{ title: "Rx issued", summary: "<doctor>, <date>" }` with no diagnosis, SOAP, or medicine lines. The same redaction applies to `GET /api/prescriptions`. Reception cannot `POST /api/prescriptions` or open `/rx`.

Deep links are existing views: appointments, prescription studio (prescribers only), billing. Uploads link to the documents section on the same chart.

## Consent

Purpose `health_document_storage`, notice version `v1`. English text is the Compliance paste. Hindi is the Compliance paragraph; a native Hindi speaker must check it before production. The clinic name is the tenant name. A blank tenant name blocks consent capture with **400** `{ "code": "CLINIC_NAME_REQUIRED" }` and the message to set the clinic name in clinic settings. The notice is not filled with an English placeholder.

`GET /api/patients/:id/document-consent`

`POST /api/patients/:id/document-consent`

```json
{ "language": "en", "method": "staff_attested_verbal", "attested": true, "guardianName": "", "guardianRelation": "" }
```

Methods: `staff_attested_verbal`, `signed_paper`, `in_app`, `whatsapp`.

A patient under 18 (date of birth, or age when date of birth is empty) requires `guardianName` and `guardianRelation`.

`POST /api/patients/:id/document-consent/withdraw` appends a withdrawal row. It does not erase stored files.

The `patient_health_document_consents` table is append-only by convention: application code only inserts grant and withdrawal rows. A database trigger or a role restriction that rejects UPDATE and DELETE is a follow-up.

## Upload

`POST /api/patients/:id/documents` multipart: `file`, `title`, `docType`, `documentDate`.

Types: `lab_report`, `prescription`, `discharge_summary`, `imaging`, `other`.

Magic bytes: PDF, JPEG, PNG, HEIC. **10 MB per file.** Without an active v1 consent the server always returns **409** `{ "code": "CONSENT_REQUIRED" }` or `{ "code": "GUARDIAN_REQUIRED" }` and stores no bytes.

`GET /api/patients/:id/documents` returns metadata plus `storage.available`. When production has no `PATIENT_DOCS_GCS_BUCKET`, `storage.available` is false, upload and read return **503**, and nothing is written to local disk.

`GET /api/patients/:id/documents/:documentId/file` is session-authenticated. A GCS V4 signed URL, when the bucket is set, is used only on the server and expires in 300 seconds. It is not returned to the client. Soft-deleted rows are omitted and are not readable.

`DELETE` sets `deleted_at`. Clinic admins, or the uploader, may delete.

## Audit

`audit_logs` rows for upload, view, delete, consent granted, and consent withdrawn include `tenant_id`, `patient_id`, `actor_role`, `entity_type`, and `entity_id`. `timestamp` is a UTC ISO-8601 string. A consent grant also records `language`, `guardianName`, and `guardianRelation` in `details`.

## Retention

In-app delete is a soft delete and hides the file immediately.

The purge job is still open. `tenants.health_document_retention_years` defaults to **3** years, and that default is waiting on the founder to confirm before real tenants. Withdrawal does not force immediate erasure.

## Not in this contract

Per-report 25 MB and 20-page caps are not enforced beyond the 10 MB file limit. WhatsApp messages are not on the timeline yet.
