export type SendLeadFollowupMessageParams = {
  channel: "sms" | "whatsapp" | "email";
  to: string;
  message: string;
  delaySeconds?: number;
  metadata?: Record<string, unknown>;
};

export type SendLeadFollowupMessageResult = {
  status: "scheduled" | "sent";
  timestamp: string;
};

export async function sendLeadFollowupMessage(
  params: SendLeadFollowupMessageParams,
): Promise<SendLeadFollowupMessageResult> {
  if (params.delaySeconds && params.delaySeconds > 0) {
    console.log("[MOCK TRANSPORT] Scheduled message", {
      channel: params.channel,
      to: params.to,
      message: params.message,
      delaySeconds: params.delaySeconds,
      metadata: params.metadata,
    });

    return {
      status: "scheduled",
      timestamp: new Date().toISOString(),
    };
  }

  console.log("[MOCK TRANSPORT] Sending message immediately", {
    channel: params.channel,
    to: params.to,
    message: params.message,
    metadata: params.metadata,
  });

  return {
    status: "sent",
    timestamp: new Date().toISOString(),
  };
}
