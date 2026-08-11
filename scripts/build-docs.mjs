#!/usr/bin/env node
// Renders README.md into docs/index.html for GitHub Pages.
//
// The page is generated rather than written so the two cannot disagree. A test
// regenerates it and fails if the committed file differs, which is what stops a
// README edit from quietly leaving a stale claim on the web.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { marked } from "marked";

const root = process.cwd();
const readme = readFileSync(join(root, "README.md"), "utf8");
const template = readFileSync(join(root, "docs", "template.html"), "utf8");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

// The heading and the opening paragraph become the masthead, so they are
// removed from the body to avoid saying everything twice.
const lines = readme.split("\n");
const firstHeading = lines.findIndex((line) => line.startsWith("# "));
const bodyStart = lines.findIndex((line, index) => index > firstHeading + 1 && line.startsWith("## "));

const tagline = lines
  .slice(firstHeading + 1, bodyStart)
  .join(" ")
  .split(".")[0]
  .replace(/\s+/g, " ")
  .trim();

const body = lines.slice(bodyStart).join("\n");

marked.setOptions({ gfm: true, headerIds: false, mangle: false });
let content = marked.parse(body);

// Wide tables scroll inside themselves rather than pushing the page sideways
// on a phone.
content = content.replace(/<table>/g, '<div class="scroll"><table>').replace(/<\/table>/g, "</table></div>");

const page = template
  .replace("{{version}}", `v${version}`)
  .replace("{{tagline}}", `${tagline}.`)
  .replace("{{content}}", content);

const banned = new RegExp("[\\u2014\\u2013]");
if (banned.test(page)) {
  console.error("docs/index.html would contain a banned dash character.");
  process.exit(1);
}

writeFileSync(join(root, "docs", "index.html"), page);
console.log(`Wrote docs/index.html (v${version}, ${page.length} bytes).`);
