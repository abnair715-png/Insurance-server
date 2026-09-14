/** Name of the httpOnly cookie carrying the agent session JWT. */
export const AUTH_COOKIE_NAME = 'iap_session';

/** Policy term used for every product in this MVP. Real products would carry
 *  their own term; a single constant keeps the quotation maths explainable. */
export const POLICY_TERM_MONTHS = 12;

export const PRODUCT_CATEGORIES = ['TERM', 'HEALTH', 'VEHICLE', 'OTHER'] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

export const QUOTATION_STATUSES = ['DRAFT', 'DOCUMENT_GENERATED', 'PAYMENT_PENDING', 'CONVERTED', 'EXPIRED'] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export const PAYMENT_STATUSES = ['CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'EXPIRED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Terminal states never transition again — the guard that makes webhook
 *  replays inert. See docs/payment-idempotency.md. */
export const TERMINAL_PAYMENT_STATUSES: PaymentStatus[] = ['SUCCEEDED', 'FAILED', 'EXPIRED'];
export const OPEN_PAYMENT_STATUSES: PaymentStatus[] = ['CREATED', 'PENDING'];

export const POLICY_STATUSES = ['ACTIVE', 'CANCELLED', 'LAPSED'] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

export const AGENT_ROLES = ['AGENT', 'ADMIN'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
export type Gender = (typeof GENDERS)[number];

export const VEHICLE_TYPES = ['TWO_WHEELER', 'CAR', 'COMMERCIAL'] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];
