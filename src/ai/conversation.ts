export type MessageRole = "user" | "model";

export interface ConversationMessage {
  role: MessageRole;
  content: string;
}

export class Conversation {
  private messages: ConversationMessage[] = [];

  addUserMessage(content: string): void {
    this.messages.push({
      role: "user",
      content,
    });
  }

  addModelMessage(content: string): void {
    this.messages.push({
      role: "model",
      content,
    });
  }

  getMessages(): ConversationMessage[] {
    return [...this.messages];
  }

  clear(): void {
    this.messages = [];
  }
}