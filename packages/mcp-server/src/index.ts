#!/usr/bin/env -S npx tsx
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { workspaceFromEnv } from './workspace-client.js';

/**
 * The stdio entrypoint.
 *
 * stdio rather than HTTP because of what this holds: an API key that opens a
 * firm's workspace. Over stdio the key lives in the environment of a process
 * the user started on their own machine and is read by nothing else. A remote
 * server would mean somebody hosting other people's keys, which is a different
 * product with a different threat model.
 *
 * NOTHING may be written to stdout but MCP frames. A stray `console.log` here
 * is not a cosmetic bug — it corrupts the JSON-RPC stream and the client
 * disconnects with a parse error that names neither the line nor the file. So
 * the one thing this prints goes to stderr, where clients show it as a log.
 */
/**
 * A client that goes away is not a fault.
 *
 * When the user quits their editor the pipe closes mid-write, and Node's
 * default for an unhandled EPIPE on a socket is to throw — so the last thing
 * in the log of a perfectly normal shutdown is a stack trace, which is what
 * somebody reads first when they come looking for a real problem. Measured
 * while smoke-testing this server: closing the reader produced eleven lines of
 * `Unhandled 'error' event`.
 */
function exitQuietlyOnBrokenPipe() {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'EPIPE') process.exit(0);
      throw e;
    });
  }
}

async function main() {
  exitQuietlyOnBrokenPipe();
  const workspace = workspaceFromEnv();
  process.stderr.write(
    workspace
      ? `apex-appraise MCP: calculation tools ready; workspace tools pointed at ${workspace.baseUrl}\n`
      : 'apex-appraise MCP: calculation tools ready. No APEX_API_KEY set, so the three workspace tools will say so if called.\n',
  );
  await createServer({ workspace }).connect(new StdioServerTransport());
}

main().catch((e: unknown) => {
  process.stderr.write(`apex-appraise MCP failed to start: ${(e as Error).message}\n`);
  process.exit(1);
});
