export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const QUEUE_NOT_FOUND = "We couldn't find that queue. Check the QR code and try again.";

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
