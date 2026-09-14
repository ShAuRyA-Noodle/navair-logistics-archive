import { z } from 'zod';

export const CHAT_MAX_BODY_BYTES = 16_000;

const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(2_000),
}).strict();

const chatPayloadSchema = z.object({
  messages: z.array(chatMessageSchema).min(1).max(20),
}).strict();

export type ChatMessage = z.infer<typeof chatMessageSchema>;

export function parseChatPayload(input: unknown): ChatMessage[] {
  const result = chatPayloadSchema.safeParse(input);
  if (!result.success) throw new Error('Invalid chat request.');

  const { messages } = result.data;
  const totalCharacters = messages.reduce((total, message) => total + message.content.length, 0);
  if (totalCharacters > 12_000 || messages.at(-1)?.role !== 'user') {
    throw new Error('Invalid chat request.');
  }
  return messages;
}
