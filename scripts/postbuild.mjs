#!/usr/bin/env node
// Copies the rules data files into dist so the published package carries them,
// and marks the CLI entry point executable.
//
// The rules live at the repository root during development, which keeps a
// community PR that updates a price point to a one line diff. Shipping them
// under dist keeps the package "files" list to a single entry.
import { copyFileSync, chmodSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";

const source = join(process.cwd(), "rules");
const target = join(process.cwd(), "dist", "rules");

mkdirSync(target, { recursive: true });

let copied = 0;
for (const name of readdirSync(source)) {
  if (!name.endsWith(".yaml")) continue;
  copyFileSync(join(source, name), join(target, name));
  copied += 1;
}

if (copied === 0) {
  console.error("No rules files found in rules/. The build would ship without data.");
  process.exit(1);
}

chmodSync(join(process.cwd(), "dist", "cli.js"), 0o755);
console.log(`Copied ${copied} rules file(s) into dist/rules.`);
