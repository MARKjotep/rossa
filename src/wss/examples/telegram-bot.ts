import type { wssMessage } from "../config.wss";
import { Websocket } from "../websocket.wss";
import { wss } from "../../router/@";

type TelegramUpdate = Record<string, any> & {
  message?: {
    chat?: { id?: string | number };
    text?: string;
  };
};

type TelegramSendMessage = {
  method: "sendMessage";
  chat_id: string | number;
  text: string;
};

/**
 * A WebSocket mock for a Telegram bot. It accepts Telegram-like update JSON
 * and returns a Telegram Bot API `sendMessage`-shaped response over the same
 * socket; it does not connect to Telegram.
 */
@wss("/examples/telegram-bot")
export class TelegramBotMockSocket extends Websocket {
  override message({ json }: wssMessage<TelegramUpdate>) {
    const chatId = json.message?.chat?.id;
    const incomingText = json.message?.text?.trim();

    if ((typeof chatId !== "string" && typeof chatId !== "number") || !incomingText) {
      this.send = JSON.stringify({
        method: "sendMessage",
        chat_id: chatId ?? null,
        text: "Send a Telegram-style update with message.chat.id and message.text.",
      } satisfies TelegramSendMessage | Record<string, unknown>);
      return;
    }

    this.send = JSON.stringify({
      method: "sendMessage",
      chat_id: chatId,
      text: telegramReply(incomingText),
    } satisfies TelegramSendMessage);
  }
}

function telegramReply(text: string): string {
  if (text === "/start") return "Welcome! I’m a demo bot. Send /help to see what I can do.";
  if (text === "/help") return "Try /start, /help, or /echo followed by a message.";
  if (text.startsWith("/echo ")) return text.slice("/echo ".length).slice(0, 4_000);
  if (text.startsWith("/")) return "I don’t know that command. Try /help.";
  return `You said: ${text.slice(0, 4_000)}`;
}
