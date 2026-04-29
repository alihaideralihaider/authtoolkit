export type ReviewCaptureInput = {
  customerId?: string;
  customerName?: string;
  serviceId?: string;
  ratingHint?: number;
  reviewDestinationUrl?: string;
  metadata?: Record<string, unknown>;
};

export type ReviewCaptureOutput = {
  status: "not_implemented";
  message: string;
  destinationUrl?: string;
  metadata?: Record<string, unknown>;
};

