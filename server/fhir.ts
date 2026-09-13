/**
 * Lumera Health ABDM v3 & NRCeS FHIR R4 Bundle Serializer
 * Conforms to National Resource Centre for EHR Standards (NRCeS) India:
 * - PrescriptionRecord (https://nrces.in/ndhm/fhir/r4/StructureDefinition/PrescriptionRecord)
 * - DiagnosticReportRecord (https://nrces.in/ndhm/fhir/r4/StructureDefinition/DiagnosticReportRecord)
 * - OPConsultRecord (https://nrces.in/ndhm/fhir/r4/StructureDefinition/OPConsultRecord)
 * - DischargeSummaryRecord (https://nrces.in/ndhm/fhir/r4/StructureDefinition/DischargeSummaryRecord)
 */

import crypto from "node:crypto";
import { isAbdmPlaceholderRegistryMode } from "./abdm-mode.ts";
import { ABDM_REGISTRY_PENDING_NOTE } from "../src/lib/abdmRegistryLabel.ts";

export { isAbdmPlaceholderRegistryMode, ABDM_REGISTRY_PENDING_NOTE };
