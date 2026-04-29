export type IntentType =
  | "order_new"
  | "order_repeat"
  | "order_status"
  | "booking"
  | "quote_request"
  | "support"
  | "complaint"
  | "general_question"
  | "unknown";

export type IntentInput = {
  message: string;
  vertical?: "restaurant" | "services" | "general";
  metadata?: Record<string, unknown>;
};

export type IntentOutput = {
  intent: IntentType;
  confidence: number;
  reason: string;
};
