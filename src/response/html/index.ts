import { getHead, headType, makeID } from "../../@";

export class HTML {
  lang: string;
  head: string = "";
  constructor(lang: string, htmlHead?: headType) {
    this.lang = lang;
    if (htmlHead) {
      this.head = getHead(htmlHead);
    }
  }
  body(ctx: string, id?: string) {
    return [
      `<!DOCTYPE html><html lang="${this.lang}">`,
      `<head>${this.head}</head>`,
      `<body id="${id ?? makeID(5)}">${ctx}</body>`,
      "</html>",
    ].join("");
  }
}
