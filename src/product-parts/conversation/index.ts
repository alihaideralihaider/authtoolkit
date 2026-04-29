import type { ConversationInput, ConversationOutput } from "./types";

export async function runConversation(
  input: ConversationInput,
): Promise<ConversationOutput> {
  // TODO: Define role config, state handling, response builder, and output schema.
  void input;

  return {
    status: "not_implemented",
    message: "Conversation product part scaffold only.",
  };
}

export type { ConversationInput, ConversationOutput } from "./types";

