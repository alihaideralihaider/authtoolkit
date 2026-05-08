export type TrustAction =
  | "send_sms"
  | "send_whatsapp"
  | "send_email"
  | "call_customer"
  | "create_order"
  | "book_service"
  | "escalate_to_human";

export type ConsentStatus = "valid" | "missing" | "denied" | "stale" | "unclear";

export type TrustConsentInput = {
  action: TrustAction;
  channel?: "sms" | "whatsapp" | "email" | "phone";
  consent?: {
    status: ConsentStatus;
    channel?: "sms" | "whatsapp" | "email" | "phone";
    source?: "checkout_opt_in" | "ivr_press_1" | "web_form" | "manual" | "unknown";
    grantedAt?: string;
    reason?: string;
  };
  riskSignals?: {
    repeatedIp?: boolean;
    suspiciousPhone?: boolean;
    blockedCustomer?: boolean;
    highComplaintHistory?: boolean;
  };
  metadata?: Record<string, unknown>;
};

export type TrustConsentOutput = {
  decision: "allowed" | "blocked" | "needs_review";
  reason: string;
  requiredAction?: "request_consent" | "manual_review" | "do_not_contact" | "none";
  metadata?: Record<string, unknown>;
};
