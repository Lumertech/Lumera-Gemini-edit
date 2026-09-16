import { Router, type Request, type Response } from "express";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import { createWhatsAppRouter } from "./whatsapp.ts";
import { createMetaRouter } from "./meta.ts";
import { createAbdmRouter } from "./abdm.ts";
import {
  DEMO_TENANT_ID,
  getDb,
  mapDoctor,
  mapSubscription,
  assignedRoleForPracticeType,
  normalizePracticeType,
  publicUser,
  seedSubscriptionsIfMissing,
  writeAudit,
  type DbUser,
  type UserRole,
  type UserStatus,
} from "./db.ts";
import { persistSpecialtyPackId } from "../src/lib/specialtyPack.ts";
import { PRODUCT_NAME } from "../src/brand.ts";
import { reportCaughtError } from "./error-tracker.ts";
import { createClinicalRouter } from "./clinical.ts";
import { createBillingRouter } from "./billing.ts";
import { createDoctorScheduleRouter } from "./doctor-schedule-api.ts";
