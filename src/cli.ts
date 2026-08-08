#!/usr/bin/env node
import { run } from "./run.js";

// Piping into head or less closes stdout early. Exit quietly instead of
// printing a stack trace at someone who just wanted the first few lines.
process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

process.exitCode = run(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
});
