# MCP notes example

A small Rossa MCP server backed by SQLite. It exposes three tools:

| Tool           | Input             | Behavior                                            |
| -------------- | ----------------- | --------------------------------------------------- |
| `add-note`     | `{ text: string }`| Persists a note and confirms the new id.            |
| `list-notes`   | none              | Returns up to 20 recent notes as `#id: text` lines. |
| `search-notes` | `{ query: string }` | Returns notes whose text contains the query.      |

## Run

```sh
bun run examples/mcp/server.ts
# or
PORT=4000 bun run examples/mcp/server.ts
```

The endpoint is served at `http://localhost:3000/mcp` (or the configured
`PORT`). Notes are stored in `examples/mcp/data/notes.sqlite`, which is created
on first run.

Each HTTP request creates a fresh `McpServer` and runs the controller's
`build()` against it. The controller instance itself is shared; keep mutable
controller fields for intentionally shared state only.

## MCP Inspector

```sh
npx @modelcontextprotocol/inspector
```

Choose the Streamable HTTP transport and connect to `http://localhost:3000/mcp`.

## One-shot `tools/list` with curl

```sh
curl -s http://localhost:3000/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H 'MCP-Protocol-Version: 2026-07-28' \
  -H 'MCP-Method: tools/list' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {
      "_meta": {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  }'
```

The response is a JSON-RPC result listing `add-note`, `list-notes`, and
`search-notes`.
