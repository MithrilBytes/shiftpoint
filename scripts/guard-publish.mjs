#!/usr/bin/env node
// Refuses to publish. There is no flag, no environment variable, and no
// argument that makes this script exit zero.
//
// shiftpoint is not going to the npm registry. It is distributed by clone, and
// the decision is deliberate rather than a not-yet. This runs from
// prepublishOnly, which fires on publish, so the refusal is observable.
//
// package.json also carries "private": true, which npm documents as refusing
// publication. Both guards are kept because they fail in different places and
// neither alone is enough: the "private" check sits behind npm's own
// authentication step, so on a machine that is not logged in it never runs, and
// "npm publish --dry-run" does not exercise it at all.
//
// If this project's mind is ever changed, the change belongs in a commit that
// says so, not in an environment variable set at the moment of publishing.

console.error(
  [
    "Refusing to publish. shiftpoint does not go to the npm registry.",
    "",
    "This is not a not-yet. It is distributed by clone:",
    "",
    "  git clone https://github.com/MithrilBytes/shiftpoint.git",
    "  cd shiftpoint && npm install && npm run build",
    "  npm link          # optional, puts shiftpoint on your PATH",
    "",
    "Publishing cannot be undone: a version number can never be reused, and",
    "unpublishing is restricted after 72 hours.",
  ].join("\n"),
);

process.exit(1);
