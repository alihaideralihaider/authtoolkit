import type { ReviewCaptureInput, ReviewCaptureOutput } from "./types";

export async function runReviewCapture(
  input: ReviewCaptureInput,
): Promise<ReviewCaptureOutput> {
  // TODO: Define review gating, destination routing, suppression rules, and audit logs.
  void input;

  return {
    status: "not_implemented",
    message: "Review capture product part scaffold only.",
  };
}

export type { ReviewCaptureInput, ReviewCaptureOutput } from "./types";

