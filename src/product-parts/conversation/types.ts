export type ConversationInput = {
  sessionId?: string;
  message: string;
  roleId?: string;
  context?: Record<string, unknown>;
};

export type ConversationOutput = {
  status: "not_implemented";
  message: string;
  reply?: string;
  intent?: string;
  metadata?: Record<string, unknown>;
};

