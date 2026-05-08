import type { TrustAction, TrustConsentInput, TrustConsentOutput } from "./types";

const outboundMessagingActions = new Set<TrustAction>([
  "send_sms",
  "send_whatsapp",
  "send_email",
]);

export function evaluateTrustConsent(
  input: TrustConsentInput,
): TrustConsentOutput {
  if (input.action === "escalate_to_human") {
    return {
      decision: "allowed",
      reason: "Human escalation is always allowed.",
      requiredAction: "none",
      metadata: input.metadata,
    };
  }

  if (input.riskSignals?.blockedCustomer) {
    return {
      decision: "blocked",
      reason: "Customer is blocked.",
      requiredAction: "do_not_contact",
      metadata: input.metadata,
    };
  }

  if (outboundMessagingActions.has(input.action)) {
    return evaluateOutboundMessaging(input);
  }

  const reviewReason = getRiskReviewReason(input);

  if (reviewReason) {
    return {
      decision: "needs_review",
      reason: reviewReason,
      requiredAction: "manual_review",
      metadata: input.metadata,
    };
  }

  return {
    decision: "allowed",
    reason: "Action is allowed by current trust and consent rules.",
    requiredAction: "none",
    metadata: input.metadata,
  };
}

function evaluateOutboundMessaging(
  input: TrustConsentInput,
): TrustConsentOutput {
  if (!input.consent || input.consent.status === "missing") {
    return {
      decision: "blocked",
      reason: "Outbound messaging requires explicit consent.",
      requiredAction: "request_consent",
      metadata: input.metadata,
    };
  }

  if (input.consent.status === "denied") {
    return {
      decision: "blocked",
      reason: input.consent.reason ?? "Consent was denied.",
      requiredAction: "do_not_contact",
      metadata: input.metadata,
    };
  }

  if (input.consent.status === "stale" || input.consent.status === "unclear") {
    return {
      decision: "blocked",
      reason: input.consent.reason ?? `Consent is ${input.consent.status}.`,
      requiredAction: "request_consent",
      metadata: input.metadata,
    };
  }

  if (input.consent.status !== "valid") {
    return {
      decision: "blocked",
      reason: "Consent is not valid.",
      requiredAction: "request_consent",
      metadata: input.metadata,
    };
  }

  if (!input.channel || !input.consent.channel) {
    return {
      decision: "blocked",
      reason: "Outbound messaging requires a matching action channel and consent channel.",
      requiredAction: "request_consent",
      metadata: input.metadata,
    };
  }

  if (input.channel !== input.consent.channel) {
    return {
      decision: "blocked",
      reason: `Consent is for ${input.consent.channel}, not ${input.channel}.`,
      requiredAction: "request_consent",
      metadata: input.metadata,
    };
  }

  const reviewReason = getRiskReviewReason(input);

  if (reviewReason) {
    return {
      decision: "needs_review",
      reason: reviewReason,
      requiredAction: "manual_review",
      metadata: input.metadata,
    };
  }

  return {
    decision: "allowed",
    reason: "Valid matching consent is present.",
    requiredAction: "none",
    metadata: input.metadata,
  };
}

function getRiskReviewReason(input: TrustConsentInput) {
  if (input.riskSignals?.repeatedIp) {
    return "Repeated IP activity requires review.";
  }

  if (input.riskSignals?.suspiciousPhone) {
    return "Suspicious phone activity requires review.";
  }

  if (input.riskSignals?.highComplaintHistory) {
    return "High complaint history requires review.";
  }

  return null;
}

export type {
  ConsentStatus,
  TrustAction,
  TrustConsentInput,
  TrustConsentOutput,
} from "./types";
