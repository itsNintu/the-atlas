export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public retryable = false,
    public details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}
export function fail(
  status: number,
  code: string,
  message: string,
  retryable = false,
): never {
  throw new ApiError(status, code, message, retryable);
}
export function object(x: unknown): Record<string, any> {
  if (!x || typeof x !== "object" || Array.isArray(x))
    fail(400, "invalid_request", "Expected JSON object");
  return x as Record<string, any>;
}
export function text(x: unknown, name: string, max = 512): string {
  if (typeof x !== "string" || !x.trim() || x.length > max)
    fail(
      400,
      "invalid_request",
      `${name} must be nonempty text, at most ${max} characters`,
    );
  return x as string;
}
export function timestamp(x: unknown, name: string): string {
  const s = text(x, name, 40);
  if (
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(s) ||
    !Number.isFinite(Date.parse(s))
  )
    fail(400, "invalid_request", `${name} must be a UTC RFC3339 timestamp`);
  const normalized = new Date(s).toISOString();
  if (s.slice(0, 19) !== normalized.slice(0, 19))
    fail(400, "invalid_request", `${name} contains an invalid calendar date`);
  return normalized;
}
export function integer(
  x: unknown,
  name: string,
  min: number,
  max: number,
  fallback?: number,
): number {
  if (x === undefined && fallback !== undefined) return fallback;
  if (typeof x !== "number" || !Number.isInteger(x) || x < min || x > max)
    fail(
      400,
      "invalid_request",
      `${name} must be an integer in [${min}, ${max}]`,
    );
  return x as number;
}
