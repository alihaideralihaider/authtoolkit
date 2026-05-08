import type { IntentOutput } from "../intent-classification";
import type { LeadFollowupOutput } from "../lead-followup";
import type {
  TrustConsentInput,
  TrustConsentOutput,
} from "../trust-consent";

export type PipelineInput = {
  message: string;
  channel?: "sms" | "whatsapp" | "email";
  contactValue?: string;
  consent?: TrustConsentInput["consent"];
  riskSignals?: TrustConsentInput["riskSignals"];
};

export type PipelineOutput = {
  intent: IntentOutput;
  trust: TrustConsentOutput;
  followup?: LeadFollowupOutput;
};
