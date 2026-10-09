import { STAFF_ROLES, type StaffRole, type TicketStatus } from "./rows";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const QUEUE_NOT_FOUND = "We couldn't find that shop. Check the QR code and try again.";

export interface TextOptions {
  label: string;
  min?: number;
  max: number;
}

export function text(value: unknown, options: TextOptions): string {
  const min = options.min ?? 1;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(400, `${options.label} is required.`);
  }
  const trimmed = value.trim();
  if (trimmed.length < min) {
    throw new ApiError(400, `${options.label} must be at least ${min} characters.`);
  }
  if (trimmed.length > options.max) {
    throw new ApiError(400, `${options.label} must be ${options.max} characters or fewer.`);
  }
  return trimmed;
}

export function optionalText(value: unknown, label: string, max: number): string {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") {
    throw new ApiError(400, `${label} must be text.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new ApiError(400, `${label} must be ${max} characters or fewer.`);
  }
  return trimmed;
}

export function email(value: unknown): string {
  const raw = text(value, { label: "Email", max: 254 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    throw new ApiError(400, "Enter a valid email address.");
  }
  return raw.toLowerCase();
}

export function isSlug(value: string): boolean {
  return /^[a-z0-9-]{1,60}$/.test(value);
}

/** Public ids are UUIDs. Anything else is rejected before it reaches SQL. */
export function id(value: unknown, label = "Reference"): string {
  const raw = text(value, { label, max: 64 });
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(raw)) {
    throw new ApiError(400, `${label} is not valid.`);
  }
  return raw;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Accepts `#rrggbb` only, so nothing can be smuggled into a style attribute. */
export function colour(value: unknown, label: string): string {
  const raw = optionalText(value, label, 7);
  if (!raw) return "";
  if (!HEX.test(raw)) {
    throw new ApiError(400, `${label} must be a colour like #1F6FEB.`);
  }
  return raw.toLowerCase();
}

/**
 * Logos travel either as an https URL or as a data URL so a shop can paste a
 * picture without giving us a file server. Anything else is refused.
 */
export function logoValue(value: unknown, label: string, max: number): string {
  const raw = optionalText(value, label, max);
  if (!raw) return "";
  if (raw.startsWith("https://")) return raw;
  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(raw)) return raw;
  throw new ApiError(400, `${label} must be an https link or an uploaded image.`);
}

export function role(value: unknown): StaffRole {
  const raw = optionalText(value, "Role", 20).toLowerCase();
  if (!STAFF_ROLES.includes(raw as StaffRole)) {
    throw new ApiError(400, "Choose a valid role.");
  }
  return raw as StaffRole;
}

export function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new ApiError(400, `${label} must be on or off.`);
  }
  return value;
}

/** Staff tick a box or press a button. We never trust the raw value. */
export function oneOf<T extends string>(value: unknown, options: readonly T[], label: string): T {
  const raw = optionalText(value, label, 40).toLowerCase();
  if (!options.includes(raw as T)) {
    throw new ApiError(400, `${label} is not a valid choice.`);
  }
  return raw as T;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function timeOfDay(value: unknown, label: string): string {
  const raw = optionalText(value, label, 5);
  if (!raw) return "";
  if (!HHMM.test(raw)) {
    throw new ApiError(400, `${label} must look like 09:00.`);
  }
  return raw;
}

export function ticketStatus(value: unknown): TicketStatus {
  return oneOf(
    value,
    ["waiting", "called", "on_hold", "served", "skipped", "no_show", "cancelled"] as const,
    "Status"
  );
}

/** A phone number is optional everywhere, so anything short of a number fails. */
export function phone(value: unknown): string {
  const raw = optionalText(value, "Phone", 32);
  if (!raw) return "";
  if (!/^[+()\d][\d\s()+-]{4,31}$/.test(raw)) {
    throw new ApiError(400, "Enter a valid phone number, or leave it blank.");
  }
  return raw;
}