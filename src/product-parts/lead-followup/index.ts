import type { LeadFollowupInput, LeadFollowupOutput } from "./types";

export function chooseLeadFollowupChannel(
  input: LeadFollowupInput,
): "sms" | "whatsapp" | "email" | undefined {
  if (input.consent?.channel) {
    return input.consent.channel;
  }

  if (input.contactMethod === "whatsapp") {
    return "whatsapp";
  }

  if (input.contactMethod === "sms" || input.source === "missed_call") {
    return "sms";
  }

  if (input.contactMethod === "email") {
    return "email";
  }

  return undefined;
}

export function buildLeadFollowupMessage(input: LeadFollowupInput): string {
  const name = input.customerName?.trim();
  const greeting = name ? `Hi ${name}, ` : "Hi, ";

  if (input.source === "missed_call") {
    return `${greeting}sorry we missed your call. How can we help you today?`;
  }

  if (input.source === "web_form") {
    return `${greeting}thanks for reaching out. We received your request and can help with the next step.`;
  }

  if (input.source === "checkout") {
    return `${greeting}thanks for your order. We are following up to make sure everything is clear.`;
  }

  return `${greeting}we are following up on your request. How can we help with the next step?`;
}

export async function runLeadFollowup(
  input: LeadFollowupInput,
): Promise<LeadFollowupOutput> {
  if (!input.contactValue?.trim()) {
    return {
      status: "error",
      reason: "Missing contact value.",
      recommendedAction: "none",
      delaySeconds: 0,
      metadata: input.metadata,
    };
  }

  if (input.contactMethod === "unknown") {
    return {
      status: "needs_review",
      reason: "Contact method is unknown.",
      recommendedAction: "manual_review",
      delaySeconds: 0,
      metadata: input.metadata,
    };
  }

  if (input.consent?.canMessage === false) {
    return {
      status: "blocked",
      reason: input.consent.reason ?? "Messaging consent is not available.",
      recommendedAction: "ask_for_consent",
      delaySeconds: 0,
      metadata: input.metadata,
    };
  }

  const channel = chooseLeadFollowupChannel(input);

  if (!channel) {
    return {
      status: "needs_review",
      reason: "No supported follow-up channel could be selected.",
      recommendedAction: "manual_review",
      delaySeconds: 0,
      metadata: input.metadata,
    };
  }

  return {
    status: "ready",
    reason: "Lead is eligible for initial follow-up.",
    recommendedAction: "send_initial_followup",
    channel,
    messageDraft: buildLeadFollowupMessage(input),
    delaySeconds: 0,
    metadata: input.metadata,
  };
}

export type { LeadFollowupInput, LeadFollowupOutput } from "./types";
