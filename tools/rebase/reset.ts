#!/usr/bin/env -S deno run -A --lock=tools/deno.lock.json
import Logger from "https://deno.land/x/logger@v1.1.6/logger.ts";
const logger = new Logger();

logger.info("Starting reset action...");

const exec = async (command: string, args: Deno.CommandOptions = {}) =>
  await new Deno.Command(command.split(" ")[0], {
    stdout: "inherit",
    stderr: "inherit",
    args: command.split(" ").slice(1),
    ...args,
  })
    .spawn().output();

await exec("rm -rf deno");
await exec("rm -rf deno_ast");
await exec("rm -rf deno_lint");

await Promise.all([
  exec("git clone https://github.com/unyt-org/deno"),
  exec("git clone https://github.com/unyt-org/deno_ast"),
  exec("git clone https://github.com/unyt-org/deno_lint"),
]);

logger.info("Finished reset");
