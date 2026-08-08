#!/usr/bin/env node
// Empties dist before a build.
//
// tsc overwrites but never removes, so a renamed or deleted source file leaves
// its old output behind. With "files": ["dist"] that stale output ships, and a
// renamed entry point is exactly the case where nothing else would catch it.
import { rmSync } from "node:fs";
import { join } from "node:path";

rmSync(join(process.cwd(), "dist"), { recursive: true, force: true });
