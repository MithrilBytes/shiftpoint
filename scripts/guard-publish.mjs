#!/usr/bin/env node
// Refuses to publish unless the intent is stated explicitly.
//
// package.json also carries "private": true, which npm documents as refusing
// publication. That guard is real but it is not observable from a machine that
// is not logged in, because the authentication check runs first, and it is not
// exercised by "npm publish --dry-run" at all. This script runs from
// prepublishOnly, which does fire on publish, so the guard can be tested.
//
// To publish deliberately:
//   SHIFTPOINT_ALLOW_PUBLISH=1 npm publish
// and remove "private": true from package.json, which npm requires separately.

if (process.env.SHIFTPOINT_ALLOW_PUBLISH !== "1") {
  console.error(
    [
      "Refusing to publish.",
      "",
      "shiftpoint is not ready for the registry yet. If you meant to do this:",
      "",
      "  1. remove \"private\": true from package.json",
      "  2. run SHIFTPOINT_ALLOW_PUBLISH=1 npm publish",
      "",
      "Publishing is not reversible: a version number can never be reused,",
      "and unpublishing is restricted after 72 hours.",
    ].join("\n"),
  );
  process.exit(1);
}

console.log("SHIFTPOINT_ALLOW_PUBLISH is set, continuing.");
