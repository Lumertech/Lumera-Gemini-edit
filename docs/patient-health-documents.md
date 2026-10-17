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

`timeline` items, newest first: `visit`, `vitals`, `prescription`, `invoice`, `upload`, `whatsapp`, `consent`.

A visit is the appointment. Vitals recorded on that appointment are a separate item because the visit summary does not include the readings.

WhatsApp items are templates sent (`whatsapp_outbound_events`) and messages received (`whatsapp_messages` where the sender is `user` or `patient`). Both match the patient's phone on the last 10 digits inside the session tenant.

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

Magic bytes: PDF, JPEG, PNG. HEIC and HEIF are rejected. Each file must be **10 MB or smaller**. Each report must be **25 MB or smaller** and **20 pages or fewer**. An image counts as one page. Page count uses a PDF parser. If that parser cannot read the file, the upload is still accepted and the miss is logged. Without an active v1 consent the server always returns **409** `{ "code": "CONSENT_REQUIRED" }` or `{ "code": "GUARDIAN_REQUIRED" }` and stores no bytes.

`GET /api/patients/:id/documents` returns metadata plus `storage.available`. When production has no `PATIENT_DOCS_GCS_BUCKET`, `storage.available` is false, upload and read return **503**, and nothing is written to local disk.

`GET /api/patients/:id/documents/:documentId/file` is session-authenticated. A GCS V4 signed URL, when the bucket is set, is used only on the server and expires in 300 seconds. It is not returned to the client. An expired signed URL fails and is not fetched. Preview tickets expire after 300 seconds, are single-use, and an expired or replayed ticket fails. Soft-deleted rows are omitted and are not readable.

`DELETE` sets `deleted_at` and leaves the object in private storage until the retention purge. Only `CLINIC_ADMIN` in the document's tenant may delete. Doctors, the uploader, reception, and other staff receive **403**. A clinic admin from another tenant receives **404**. The chart hides Delete unless `canDelete` is true. The list, timeline, and file route hide a soft-deleted row immediately. The delete writes an audit row.

## Audit

`audit_logs` rows for upload, view, delete, consent granted, and consent withdrawn include `tenant_id`, `patient_id`, `actor_role`, `entity_type`, and `entity_id`. `timestamp` is a UTC ISO-8601 string. A consent grant also records `language`, `guardianName`, and `guardianRelation` in `details`.

## Retention

In-app delete is a soft delete and hides the file immediately.

The purge job is still open. `tenants.health_document_retention_years` defaults to **3** years, and that default is waiting on the founder to confirm before real tenants. Withdrawal does not force immediate erasure.

## Not in this contract

A database trigger that rejects UPDATE and DELETE on the consent table is still a follow-up. The purge job that removes soft-deleted report bytes is still open.
