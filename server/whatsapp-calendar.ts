// Calendar reminder/book confirmation sends go through graph-whatsapp.ts:
// sendAppointmentReminder, sendBookConfirmation, dispatchWhatsAppCloudMessage.
export {
  resolveWhatsAppTenant,
  resolveWhatsAppTenantId,
  findDoctor,
  findPatientByPhoneInTenant,
  type WhatsAppClinicChoice,
  type WhatsAppTenantResolution,
} from "./whatsapp-tenant-resolve.ts";

export {
  normalizePhoneDigits,
  phonesMatch,
  findOrCreateWhatsAppPatient,
  findActiveAppointment,
  bookWhatsAppAppointment,
  patchWhatsAppAppointment,
  getWhatsAppQueue,
  httpErrorStatus,
} from "./whatsapp-calendar-booking.ts";

export {
  tenantUtcOffsetMinutes,
  parseTimeSlot,
  appointmentInstantUtc,
  buildReminderMessage,
  dispatchAppointmentReminder,
  dispatchWhatsAppBookConfirmation,
  runAppointmentReminders,
  startAppointmentReminderScheduler,
  stopAppointmentReminderScheduler,
  type ReminderWindow,
  type ReminderDispatchResult,
  type ReminderRunItem,
} from "./whatsapp-calendar-reminders.ts";
