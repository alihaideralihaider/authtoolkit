import { runLeadFollowup } from "./index";
import type { LeadFollowupInput, LeadFollowupOutput } from "./types";

const BLOCK_COOLDOWN_SECONDS = 300; // 5 minutes
const DELAY_COOLDOWN_SECONDS = 3600; // 60 minutes

export type LeadFollowupExecutionResult = {
  decision: LeadFollowupOutput;
  shouldSend: boolean;
  blockedReason?: string;
};

function getConsentBlockReason(
  input: LeadFollowupInput,
  decision: LeadFollowupOutput,
) {
  if (!input.consent) {
    return "No explicit messaging consent";
  }

  if (input.consent.canMessage !== true) {
    return input.consent.reason ?? "Messaging consent denied";
  }

  if (input.consent.status === "stale") {
    return input.consent.reason ?? "Messaging consent is stale";
  }

  if (input.consent.status === "unclear") {
    return input.consent.reason ?? "Messaging consent is unclear";
  }

  if (!input.consent.channel) {
    return "Messaging consent channel is missing";
  }

  if (!decision.channel) {
    return "No outbound channel selected";
  }

  if (input.consent.channel !== decision.channel) {
    return `Messaging consent is for ${input.consent.channel}, not ${decision.channel}`;
  }

  return null;
}

export async function runLeadFollowupExecution(
  input: LeadFollowupInput,
): Promise<LeadFollowupExecutionResult> {
  const decision = await runLeadFollowup(input);

  if (decision.status !== "ready") {
    return {
      decision,
      shouldSend: false,
      blockedReason: decision.reason,
    };
  }

  const consentBlockReason = getConsentBlockReason(input, decision);

  if (consentBlockReason) {
    return {
      decision,
      shouldSend: false,
      blockedReason: consentBlockReason,
    };
  }

  if (input.lastContactAt) {
    const lastContactTime = new Date(input.lastContactAt).getTime();
    const now = Date.now();

    if (!Number.isNaN(lastContactTime)) {
      const secondsSinceLastContact = Math.floor((now - lastContactTime) / 1000);

      if (secondsSinceLastContact < BLOCK_COOLDOWN_SECONDS) {
        return {
          decision,
          shouldSend: false,
          blockedReason: "Lead was contacted less than 5 minutes ago.",
        };
      }

      if (secondsSinceLastContact < DELAY_COOLDOWN_SECONDS) {
        return {
          decision: {
            ...decision,
            delaySeconds: BLOCK_COOLDOWN_SECONDS,
            metadata: {
              ...decision.metadata,
              executionCheckedAt: new Date().toISOString(),
              cooldownApplied: true,
            },
          },
          shouldSend: true,
        };
      }
    }
  }

  return {
    decision,
    shouldSend: true,
  };
}
