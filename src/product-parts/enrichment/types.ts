export type DataEnrichmentInput = {
  entityId?: string;
  entityType?: "lead" | "account" | "conversation" | "customer";
  attributes?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type DataEnrichmentOutput = {
  status: "not_implemented";
  message: string;
  tags?: string[];
  score?: number;
  metadata?: Record<string, unknown>;
};

