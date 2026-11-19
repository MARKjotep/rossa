import type { wssMessage } from "../config.wss";
import { Websocket } from "../websocket.wss";
import { wss } from "../../router/@";

type MessengerEvent = Record<string, any> & {
  sender?: { id?: string };
  message?: { text?: string };
};

type MessengerReply = {
  recipient: { id: string };
  message: { text: string };
  messaging_type: "RESPONSE";
};

/** A local mock of a Messenger-style event and send-message response. */
@wss("/examples/messenger")
export class MessengerMockSocket extends Websocket {
  override message({ json }: wssMessage<MessengerEvent>) {
    const senderId = json.sender?.id;
    const text = json.message?.text?.trim();

    if (!senderId || !text) {
      this.send = JSON.stringify({
        type: "error",
        code: "invalid_event",
        expected: { sender: { id: "user-id" }, message: { text: "Hello" } },
      });
      return;
    }

    this.send = JSON.stringify({
      recipient: { id: senderId },
      message: { text: messengerReply(text) },
      messaging_type: "RESPONSE",
    } satisfies MessengerReply);
  }
}

function messengerReply(text: string): string {
  const normalized = text.toLowerCase();
  if (normalized === "hi" || normalized === "hello" || normalized === "hey") {
    return "Hello! Thanks for messaging the demo page. How can I help?";
  }
  if (normalized.includes("hours")) return "This demo is online any time. A real page can provide its business hours here.";
  if (normalized.includes("help")) return "Tell me what you need and I’ll point you in the right direction.";
  return `Thanks for your message: “${text.slice(0, 1_000)}”. This is an automated demo reply.`;
}
