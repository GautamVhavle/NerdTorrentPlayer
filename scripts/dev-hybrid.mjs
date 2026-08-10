import { spawn } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const children = [
  spawn(npmCommand, ["run", "bridge"], { stdio: "inherit" }),
  spawn(npmCommand, ["run", "dev:web"], { stdio: "inherit" }),
];

let stopping = false;

function stop(signal = "SIGTERM", exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
  const timer = setTimeout(() => process.exit(exitCode), 2_000);
  timer.unref?.();
  Promise.all(
    children.map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode) resolve();
          else child.once("exit", resolve);
        }),
    ),
  ).finally(() => process.exit(exitCode));
}

for (const child of children) {
  child.once("error", (error) => {
    console.error(error.message);
    stop("SIGTERM", 1);
  });
  child.once("exit", (code, signal) => {
    if (stopping) return;
    stop("SIGTERM", code ?? (signal ? 1 : 0));
  });
}

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));
