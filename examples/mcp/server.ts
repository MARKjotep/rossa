import { SQL } from "bun";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  DbRepository,
  DbSchema,
  McpController,
  McpServer,
  Rossa,
  mcp,
  sqliteDialect,
  t,
  z,
} from "../../src/index";

interface NoteRow {
  id: number;
  text: string;
  createdAt: string;
}

const dataDir = join(import.meta.dir, "data");
mkdirSync(dataDir, { recursive: true });

export const db = new SQL(`sqlite://${join(dataDir, "notes.sqlite")}`, {
  max: 1,
});
export const notes = new DbRepository(
  db,
  new DbSchema<NoteRow>(
    "notes",
    {
      id: t.serial().primary,
      text: t.text().notNull,
      createdAt: t.text().notNull,
    },
    sqliteDialect,
  ),
);
await notes.create();

const addInput = z.object({ text: z.string().trim().min(1).max(10_000) });
const searchInput = z.object({ query: z.string().trim().min(1).max(200) });
const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
});
const preview = (text: string) =>
  text.length > 120 ? `${text.slice(0, 117)}...` : text;
const recent = (rows: NoteRow[]) =>
  rows
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id)
    .slice(0, 20);
const render = (rows: NoteRow[], empty: string) =>
  rows.length
    ? rows.map((note) => `#${note.id}: ${preview(note.text)}`).join("\n")
    : empty;

@mcp("/mcp")
export class NotesMcpController extends McpController {
  build(server: McpServer) {
    server.registerTool(
      "add-note",
      {
        description: "Persist a note and return its id.",
        inputSchema: addInput,
      },
      async ({ text }) => {
        const row = await notes.insert({
          text,
          createdAt: new Date().toISOString(),
        } as NoteRow);
        return textResult(
          row ? `Added note #${row.id}.` : "Could not save the note.",
        );
      },
    );

    server.registerTool(
      "list-notes",
      {
        description: "Return up to 20 recent notes.",
        inputSchema: z.object({}),
      },
      async () =>
        textResult(render(recent(await notes.findAll()), "No notes yet.")),
    );

    server.registerTool(
      "search-notes",
      {
        description: "Find notes whose text contains the query.",
        inputSchema: searchInput,
      },
      async ({ query }) => {
        const rows = await notes.findAll({
          text: { operator: "LIKE", value: `%${query}%` },
        });
        return textResult(render(recent(rows), "No matching notes."));
      },
    );
  }
}

export const app = new Rossa({ Encoding: "none" });
app.registerMCP(NotesMcpController);

if (import.meta.main) {
  const port = Number(process.env.PORT ?? 3000);
  app.serve({ port });
  console.log(`MCP endpoint: http://localhost:${port}/mcp`);
}
