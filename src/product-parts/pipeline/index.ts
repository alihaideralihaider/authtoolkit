import { classifyIntent } from "../intent-classification";
import { runLeadFollowup } from "../lead-followup";
import type { LeadFollowupInput } from "../lead-followup";
import {
  evaluateTrustConsent,
  type TrustAction,
} from "../trust-consent";
import type { PipelineInput, PipelineOutput } from "./types";

export async function runProductPartsPipeline(
  input: PipelineInput,
): Promise<PipelineOutput> {
  const intent = classifyIntent({
    message: input.message,
    vertical: "general",
  });
  const action = chooseTrustAction(input, intent.intent);
  const trust = evaluateTrustConsent({
    action,
    channel: input.channel,
    consent: input.consent,
    riskSignals: input.riskSignals,
    metadata: {
      intent: intent.intent,
      confidence: intent.confidence,
    },
  });

  if (trust.decision !== "allowed") {
    return {
      intent,
      trust,
    };
  }

  const followup = await runLeadFollowup(buildFollowupInput(input, intent.intent));

  return {
    intent,
    trust,
    followup,
  };
}

function chooseTrustAction(
  input: PipelineInput,
  intent: PipelineOutput["intent"]["intent"],
): TrustAction {
  if (intent === "order_new" || intent === "order_repeat") {
    return "create_order";
  }

  if (intent === "booking") {
    return "book_service";
  }

  if (intent === "support" || intent === "complaint") {
    return "escalate_to_human";
  }

  if (input.channel === "whatsapp") {
    return "send_whatsapp";
  }

  if (input.channel === "email") {
    return "send_email";
  }

  return "send_sms";
}

function buildFollowupInput(
  input: PipelineInput,
  intent: PipelineOutput["intent"]["intent"],
): LeadFollowupInput {
  const channel = input.channel ?? "sms";

  return {
    contactMethod: channel,
    contactValue: input.contactValue,
    source: "manual",
    intent: mapFollowupIntent(intent),
    consent: input.consent
      ? {
          canMessage: input.consent.status === "valid",
          channel,
          status:
            input.consent.status === "valid"
              ? "valid"
              : input.consent.status === "stale"
                ? "stale"
                : "unclear",
          reason: input.consent.reason,
        }
      : {
          canMessage: false,
          channel,
          status: "unclear",
          reason: "No explicit messaging consent.",
        },
    metadata: {
      pipeline: "intent_trust_followup",
      intent,
    },
  };
}

function mapFollowupIntent(
  intent: PipelineOutput["intent"]["intent"],
): LeadFollowupInput["intent"] {
  if (intent === "order_new" || intent === "order_repeat" || intent === "order_status") {
    return "order";
  }

  if (intent === "booking") {
    return "booking";
  }

  if (intent === "support" || intent === "complaint") {
    return "support";
  }

  if (intent === "quote_request") {
    return "quote";
  }

  return "unknown";
}

export type { PipelineInput, PipelineOutput } from "./types";
