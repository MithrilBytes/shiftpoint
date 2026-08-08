#!/usr/bin/env node
// Fails if an em dash (U+2014) or en dash (U+2013) appears anywhere in the
// repository. Both characters are banned in shiftpoint: code, docs, terminal
// output, and commit messages. Use a comma, colon, period, or parentheses.
//
// The banned characters are written as escapes here so this file does not
// trip its own check.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";

const BANNED = new RegExp("[\\u2014\\u2013]");
const ROOT = process.cwd();

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "coverage",
  ".next",
  "__pycache__",
]);

const SKIP_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".pdf",
  ".mp4",
  ".webm",
  ".mov",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".zip",
  ".gz",
]);

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile()) {
      if (SKIP_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
      if (statSync(full).size > 2_000_000) continue;
      out.push(full);
    }
  }
  return out;
}

const hits = [];
for (const file of walk(ROOT, [])) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  if (!BANNED.test(text)) continue;
  text.split("\n").forEach((line, index) => {
    const column = line.search(BANNED);
    if (column >= 0) {
      hits.push(`${relative(ROOT, file)}:${index + 1}:${column + 1}`);
    }
  });
}

if (hits.length > 0) {
  console.error("Banned dash characters found (U+2014 or U+2013):");
  for (const hit of hits) console.error("  " + hit);
  console.error("\nUse a comma, colon, period, or parentheses instead.");
  process.exit(1);
}

console.log("No banned dash characters found.");
