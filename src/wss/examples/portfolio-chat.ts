import type { wssMessage } from "../config.wss";
import { Websocket } from "../websocket.wss";
import { wss } from "../../router/@";

type PortfolioChatCommand = Record<string, any> & {
  type?: string;
  message?: string;
};

/** A small backend-only reply handler for a portfolio site's chat widget. */
@wss("/examples/portfolio-chat")
export class PortfolioChatSocket extends Websocket {
  override open() {
    this.send = JSON.stringify({
      type: "ready",
      message: "Hi! Ask me about the portfolio owner’s work or experience.",
    });
  }

  override message({ json }: wssMessage<PortfolioChatCommand>) {
    if (json.type !== "message" || typeof json.message !== "string") {
      this.send = JSON.stringify({ type: "error", code: "invalid_message" });
      return;
    }

    const message = json.message.trim().slice(0, 1_000);
    if (!message) {
      this.send = JSON.stringify({ type: "error", code: "empty_message" });
      return;
    }

    this.send = JSON.stringify({
      type: "reply",
      message: portfolioReply(message),
    });
  }
}

function portfolioReply(message: string): string {
  const question = message.toLowerCase();
  if (question.includes("project")) return "You can browse the projects section to see selected work and case studies.";
  if (question.includes("experience") || question.includes("background")) {
    return "The about section has a short bio and work history. For more detail, use the contact page.";
  }
  if (question.includes("contact") || question.includes("email")) {
    return "Please use the contact form on this portfolio to reach the owner.";
  }
  return "Thanks for reaching out! I’m a portfolio demo assistant. Try asking about projects, experience, or contact details.";
}
