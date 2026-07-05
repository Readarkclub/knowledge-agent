import type { UIMessage } from "ai";

function isChatRequestPart(part: UIMessage["parts"][number]): boolean {
  return part.type === "text" || part.type === "step-start";
}

export function prepareChatRequestMessages(
  messages: UIMessage[]
): UIMessage[] {
  return messages
    .map((message) => ({
      ...message,
      parts: message.parts.filter(isChatRequestPart),
    }))
    .filter((message) => message.parts.length > 0);
}
