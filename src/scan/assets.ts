import type { Repo } from "./repo.js";
import type { Signal } from "../types.js";

const ASSET_FILE =
  /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|tiff?|mp4|webm|mov|m4v|mp3|wav|ogg|flac|pdf|woff2?|ttf|otf|eot)$/i;

/**
 * Weight of the images, video, audio, fonts, and documents checked into the
 * repository. Reported as a raw byte count: the threshold that turns bytes
 * into a verdict is a number, and numbers live in rules/.
 */
export function detectAssets(repo: Repo): Signal[] {
  const files = repo.matching(ASSET_FILE);
  const total = files.reduce((sum, file) => sum + repo.bytes(file), 0);

  return [
    {
      kind: "asset_bytes",
      values: [],
      confidence: "high",
      metric: total,
      evidence: `${files.length} asset file(s) totalling ${total} bytes`,
    },
  ];
}
