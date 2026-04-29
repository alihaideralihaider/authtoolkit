export type LeadFollowupInput = {
  leadId?: string;
  tenantId?: string;
  slug?: string;
  customerName?: string;
  contactMethod: "sms" | "whatsapp" | "email" | "phone" | "unknown";
  contactValue?: string;
  source?: "missed_call" | "web_form" | "checkout" | "manual" | "other";
  intent?: "order" | "booking" | "support" | "quote" | "unknown";
  consent?: {
    canMessage: boolean;
    channel?: "sms" | "whatsapp" | "email";
    reason?: string;
    status?: "valid" | "stale" | "unclear";
  };
  lastContactAt?: string;
  metadata?: Record<string, unknown>;
};

export type LeadFollowupOutput = {
  status: "ready" | "blocked" | "needs_review" | "error";
  reason: string;
  recommendedAction:
    | "send_initial_followup"
    | "ask_for_consent"
    | "manual_review"
    | "do_not_contact"
    | "none";
  channel?: "sms" | "whatsapp" | "email";
  messageDraft?: string;
  delaySeconds?: number;
  metadata?: Record<string, unknown>;
};
