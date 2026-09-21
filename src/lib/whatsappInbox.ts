/** Map WhatsApp inbox API payloads (camelCase) onto the suite UI (snake_case). */

export interface WhatsAppConversationItem {
  id: string;
  patient_phone: string;
  patient_name: string;
  patient_uhid: string;
  last_message: string;
  last_message_time: string;
  unread_count: number;
  handover_mode: "bot" | "human";
  assigned_staff: string | null;
  tag: string | null;
}

export interface WhatsAppChatMessage {
  id: string;
  conversation_id: string;
  patient_phone: string;
  sender: "bot" | "user" | "system";
  staff_name?: string | null;
  content: string;
  translated_content?: string | null;
  detected_language?: string | null;
  time_display: string;
  buttons?: string[] | null;
  media?: {
    type: "pdf" | "image";
    title: string;
    url?: string;
    size?: string;
    subtitle?: string;
    previewData?: unknown;
  } | null;
  status: string;
  created_at: string;
}

function str(raw: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = raw[key];
    if (value == null || value === "") continue;
    return String(value);
  }
  return "";
}

function firstTag(raw: Record<string, unknown>): string | null {
  const tags = raw.tags ?? raw.tag;
  if (Array.isArray(tags) && tags.length) return String(tags[0]);
  if (typeof tags === "string" && tags.trim()) return tags;
  return null;
}

export function conversationInitial(name?: string | null): string {
  const trimmed = String(name || "").trim();
  return trimmed ? trimmed.charAt(0) : "?";
}

/** Digits only, so "+91 99999 73271", "919999973271", and "+919999973271" compare equal. */
export function phoneDigits(phone?: string | null): string {
  return String(phone || "").replace(/\D/g, "");
}

function phonesMatch(a?: string | null, b?: string | null): boolean {
  const left = phoneDigits(a);
  const right = phoneDigits(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return left.length >= 10 && right.length >= 10 && left.slice(-10) === right.slice(-10);
}

/**
 * Outbound reminder/packet target. A selected EMR phone wins over the open inbox
 * thread so the panel does not stay stuck on the seed conversation.
 */
export function resolveOutboundPatient(input: {
  currentPatientName?: string | null;
  currentPatientPhone?: string | null;
  conversationName?: string | null;
  conversationPhone?: string | null;
}): { name: string; phone: string } {
  const phone = String(input.currentPatientPhone || "").trim();
  if (phone) {
    return { name: String(input.currentPatientName || "").trim(), phone };
  }
  return {
    name: String(input.conversationName || input.currentPatientName || "").trim(),
    phone: String(input.conversationPhone || "").trim(),
  };
}

/** Inbox row whose phone matches, or null. Does not create a conversation. */
export function findConversationIdByPhone<T extends { id: string; patient_phone?: string | null }>(
  conversations: T[],
  phone?: string | null,
): string | null {
  if (!phoneDigits(phone)) return null;
  const match = conversations.find((row) => phonesMatch(row.patient_phone, phone));
  return match?.id || null;
}

export function normalizeWhatsAppConversation(raw: unknown): WhatsAppConversationItem {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const handover = str(row, "handover_mode", "handoverMode").toLowerCase();
  return {
    id: str(row, "id"),
    patient_phone: str(row, "patient_phone", "patientPhone"),
    patient_name: str(row, "patient_name", "patientName"),
    patient_uhid: str(row, "patient_uhid", "uhid", "patientUhid", "patientId"),
    last_message: str(row, "last_message", "lastMessage"),
    last_message_time: str(row, "last_message_time", "lastMessageTime"),
    unread_count: Number(row.unread_count ?? row.unreadCount ?? 0) || 0,
    handover_mode: handover === "human" ? "human" : "bot",
    assigned_staff: str(row, "assigned_staff", "assignedStaff") || null,
    tag: firstTag(row),
  };
}

function asSender(value: string): WhatsAppChatMessage["sender"] {
  if (value === "user" || value === "system") return value;
  return "bot";
}

export function normalizeWhatsAppMessage(raw: unknown): WhatsAppChatMessage {
  const row = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const media = (row.media ?? null) as WhatsAppChatMessage["media"];
  const buttons = Array.isArray(row.buttons) ? (row.buttons as string[]) : null;
  return {
    id: str(row, "id"),
    conversation_id: str(row, "conversation_id", "conversationId"),
    patient_phone: str(row, "patient_phone", "patientPhone"),
    sender: asSender(str(row, "sender")),
    staff_name: str(row, "staff_name", "staffName") || null,
    content: str(row, "content"),
    translated_content: str(row, "translated_content", "translatedContent") || null,
    detected_language: str(row, "detected_language", "detectedLanguage") || null,
    time_display: str(row, "time_display", "time", "timeDisplay"),
    buttons,
    media,
    status: str(row, "status") || "delivered",
    created_at: str(row, "created_at", "createdAt"),
  };
}

export function normalizeWhatsAppConversations(raw: unknown): WhatsAppConversationItem[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.map(normalizeWhatsAppConversation).filter((row) => row.id);
}

export function normalizeWhatsAppMessages(raw: unknown): WhatsAppChatMessage[] {
  const list = Array.isArray(raw) ? raw : [];
  return list.map(normalizeWhatsAppMessage).filter((row) => row.id);
}
