export type ReminderRetentionInput = {
  entityId?: string;
  entityType?: "lead" | "customer" | "order" | "appointment" | "subscription";
  dueAt?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
};

export type ReminderRetentionOutput = {
  status: "not_implemented";
  message: string;
  suggestedDueAt?: string;
  metadata?: Record<string, unknown>;
};

