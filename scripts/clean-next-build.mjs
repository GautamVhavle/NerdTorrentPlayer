import { rm } from "node:fs/promises";

// Next.js and vinext both generate framework metadata under .next. Clearing
// that disposable cache prevents one build target from reading the other's
// generated types while preserving source files and deployment output.
await Promise.all(
  ["../.next", "../.next-vercel"].map((path) =>
    rm(new URL(path, import.meta.url), {
      recursive: true,
      force: true,
    }),
  ),
);
