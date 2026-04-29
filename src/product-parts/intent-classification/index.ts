import type { IntentInput, IntentOutput, IntentType } from "./types";

type IntentRule = {
  intent: IntentType;
  confidence: number;
  keywords: string[];
};

const rules: IntentRule[] = [
  {
    intent: "order_repeat",
    confidence: 0.92,
    keywords: ["again", "same order", "repeat"],
  },
  {
    intent: "order_status",
    confidence: 0.9,
    keywords: ["where is my order", "status"],
  },
  {
    intent: "order_new",
    confidence: 0.88,
    keywords: ["order", "buy", "want food"],
  },
  {
    intent: "booking",
    confidence: 0.86,
    keywords: ["book", "appointment"],
  },
  {
    intent: "support",
    confidence: 0.84,
    keywords: ["problem", "issue", "not working"],
  },
  {
    intent: "complaint",
    confidence: 0.9,
    keywords: ["bad", "complain", "refund"],
  },
];

const serviceRules: IntentRule[] = [
  {
    intent: "support",
    confidence: 0.91,
    keywords: ["urgent", "emergency", "asap"],
  },
  {
    intent: "booking",
    confidence: 0.89,
    keywords: ["schedule", "visit", "technician"],
  },
  {
    intent: "quote_request",
    confidence: 0.9,
    keywords: [
      "pest control",
      "cockroach",
      "termite",
      "rodent",
      "bed bug",
      "ants",
      "cleaning",
      "deep cleaning",
      "office cleaning",
      "villa cleaning",
    ],
  },
];

export function classifyIntent(input: IntentInput): IntentOutput {
  const message = normalizeMessage(input.message);

  if (!message) {
    return {
      intent: "unknown",
      confidence: 0,
      reason: "empty message",
    };
  }

  if (input.vertical === "services") {
    const serviceResult = classifyWithRules(message, serviceRules);

    if (serviceResult) {
      return serviceResult;
    }
  }

  for (const rule of rules) {
    const result = classifyWithRule(message, rule);

    if (result) {
      return result;
    }
  }

  if (isGeneralQuestion(message)) {
    return {
      intent: "general_question",
      confidence: 0.72,
      reason: "matched general question pattern",
    };
  }

  return {
    intent: "unknown",
    confidence: 0.4,
    reason: "no keyword match",
  };
}

function classifyWithRules(message: string, inputRules: IntentRule[]) {
  for (const rule of inputRules) {
    const result = classifyWithRule(message, rule);

    if (result) {
      return result;
    }
  }

  return null;
}

function classifyWithRule(
  message: string,
  rule: IntentRule,
): IntentOutput | null {
  const matchedKeyword = rule.keywords.find((keyword) =>
    message.includes(keyword),
  );

  if (!matchedKeyword) {
    return null;
  }

  return {
    intent: rule.intent,
    confidence: rule.confidence,
    reason: `matched keyword: ${matchedKeyword}`,
  };
}

function normalizeMessage(message: string) {
  return message
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGeneralQuestion(message: string) {
  return (
    message.includes("?") ||
    message.startsWith("what ") ||
    message.startsWith("how ") ||
    message.startsWith("when ") ||
    message.startsWith("where ") ||
    message.startsWith("do you ") ||
    message.startsWith("can you ")
  );
}

export type { IntentInput, IntentOutput, IntentType } from "./types";
