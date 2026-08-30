export type ChatGptConversationLocation = {
  conversationId: string;
  kind: "standard" | "project";
  projectId: string | null;
};

const CONVERSATION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,199}$/;
const PROJECT_ID = /^g-p-[A-Za-z0-9_-]{3,200}$/;

export function parseChatGptConversationPath(pathname: string): ChatGptConversationLocation | null {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 2 && segments[0] === "c" && CONVERSATION_ID.test(segments[1])) {
    return { conversationId: segments[1], kind: "standard", projectId: null };
  }
  if (
    segments.length === 4
    && segments[0] === "g"
    && PROJECT_ID.test(segments[1])
    && segments[2] === "c"
    && CONVERSATION_ID.test(segments[3])
  ) {
    return { conversationId: segments[3], kind: "project", projectId: segments[1] };
  }
  return null;
}

export function parseChatGptConversationUrl(value: string | URL): ChatGptConversationLocation | null {
  try {
    const url = value instanceof URL ? value : new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "chatgpt.com") return null;
    return parseChatGptConversationPath(url.pathname);
  } catch {
    return null;
  }
}
