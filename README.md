# screen-resolver-mcp

A TypeScript MCP server for identifying songs and artists from the KTV screenshots in [for1096/songs](https://huggingface.co/datasets/for1096/songs), plus a searchable results website.

## Exactly two MCP tools

- `get_screenshots`: returns up to 20 screenshot IDs and direct image URLs from the Hugging Face dataset.
- `submit_song_recognitions`: accepts model-recognized song titles and artists, linked to screenshot IDs, and appends them to SQLite.

The MCP does not perform its own vision-model inference. ChatGPT/the connected model inspects the returned images and calls the submission tool with its recognition results.

## Append-only persistence

Results are stored in `data/songs.sqlite` by default. Each submission creates a new batch and new recognition rows. There are no update/delete operations or uniqueness constraints that silently discard repeated observations. The same song or screenshot may appear in multiple batches, preserving recognition history. Back up the `data` directory to preserve records.

## Run locally

Requires Node.js 20 or newer.

```sh
npm install
npm run build
npm run dev
```

The MCP stdio entrypoint is suitable for local MCP clients. Configure the command as `node` with arguments `/absolute/path/to/screen-resolver-mcp/dist/index.js` after building.

For a remote MCP host that supports Streamable HTTP, run:

```sh
npm run http
```

The endpoint is `http://localhost:8787/mcp`; deploy it behind HTTPS and configure authentication at the hosting/reverse-proxy layer before registering it as a remote ChatGPT connector. A publicly reachable URL alone does not make a local service accessible.

Run the results website separately:

```sh
npm run web
```

Then open http://localhost:3000. Both processes use the same `DATA_DIR` (default `data`) and SQLite database. Set `DATA_DIR` to a persistent writable directory when deploying.

## Configuration

- `HF_DATASET_ID`: defaults to `for1096/songs`.
- `SCREENSHOT_START`: starting index for the screenshot batch (defaults to `0`).
- `DATA_DIR`: SQLite data directory (defaults to `data`).
- `PORT`: results website port (defaults to `3000`).
- `MCP_PORT`: Streamable HTTP MCP port (defaults to `8787`).

## Notes

- Dataset file layout and Hugging Face API pagination may change; verify screenshot discovery against the live dataset before a large batch run.
- Do not expose the results website publicly without appropriate access controls if the records should remain private.
- This repository stores model outputs as historical observations, not verified ground truth.
