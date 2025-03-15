#!/usr/bin/env -S deno run -A --lock=tools/deno.lock.json
// Usage ./rebase.ts <optional release of denoland/deno>
import Logger from "https://deno.land/x/logger@v1.1.6/logger.ts";
import * as semver from "https://deno.land/x/semver/mod.ts";

const logger = new Logger();

const GITHUB_BASE_URL = "https://api.github.com/repos";
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN");
const denoTag = Deno.args[0] ?? "latest";

logger.info(`Starting rebase action to release ${denoTag}...`);
!GITHUB_TOKEN &&
  logger.warn(
    "No GITHUB_TOKEN configured: You may want to add the token as repository secret.",
  );

const requestGithubAPI = async <T>(route: string, repo = "denoland/deno") => {
  const request = await fetch(
    `${GITHUB_BASE_URL}/${repo}${route}`,
    GITHUB_TOKEN
      ? {
        headers: {
          "Authorization": `Bearer ${GITHUB_TOKEN}`,
        },
      }
      : undefined,
  );
  if (!request.ok) {
    let message: string = undefined!;
    try {
      message = (await request.json()).message;
    } catch { /**/ }
    if (message) {
      throw new Error(
        `[Request error] ${request.status}: ${
          message ?? request.statusText ?? "empty"
        }"`,
      );
    }
    throw new Error(
      `[Request error] ${request.status}: ${request.statusText ?? "empty"}"`,
    );
  }
  return await request.json() as T;
};

const getCommitForRelease = async (repo: string, release: string) => {
  try {
    const tag = release === "latest" ? await getLatestTag(repo) : release;
    const { type, sha } = (await requestGithubAPI<
      { object: { type: "commit" | string; sha: string } }
    >(`/git/ref/tags/${tag}`, repo)).object;
    const latestHash = type === "commit"
      ? sha
      : (await requestGithubAPI<{ object: { sha: string } }>(
        `/git/tags/${sha}`,
        repo,
      )).object.sha;
    if (!latestHash) {
      throw new Error();
    }
    return latestHash;
  } catch {
    throw new Error(
      `Could not get commit for release '${release}' for ${repo}`,
    );
  }
};
const getLatestTag = async (repo?: string) =>
  (await requestGithubAPI<{ tag_name: string }>(`/releases/latest`, repo))
    .tag_name;

const exec = async (command: string, args: Deno.CommandOptions = {}) => {
  logger.info(`Running command ${command}`, args);
  await new Deno.Command(command.split(" ")[0], {
    stdout: "inherit",
    stderr: "inherit",
    args: command.split(" ").slice(1),
    ...args,
  })
    .spawn().output();
};

const rebaseRepo = async (
  repo: string,
  directory: string,
  commit: string = "upstream/main",
) => {
  logger.info(`Rebasing ${repo} to commit ${commit}...`);
  try {
    await exec(`git remote add upstream https://github.com/${repo}.git`, {
      stderr: "null",
      cwd: directory,
    });
  } catch {
    logger.warn(`Remote upstream for ${repo} does already exist`);
  }
  await exec("git fetch upstream", { cwd: directory, stdout: "null" });
  await exec(`git rebase -X theirs ${commit}`, { cwd: directory });
  await exec("git rm Cargo.lock", { cwd: directory });
  await exec("git -c core.editor=true rebase --continue", {
    cwd: directory,
    stdout: "null",
  });

  logger.info(`Successfully rebased ${repo} to commit ${commit}`);
};

const getLintReleaseForAstVersion = async (astVersion: string) => {
  const availableReleases = (await requestGithubAPI<{ tag_name: string }[]>(
    "/releases",
    "denoland/deno_lint",
  )).map((e) => e.tag_name);
  logger.info(
    `Found ${availableReleases.length} releases for denoland/deno_lint`,
  );
  for (const release of availableReleases) {
    const commit = await getCommitForRelease("denoland/deno_lint", release);
    const tomlConfig = await (await fetch(
      `https://raw.githubusercontent.com/denoland/deno_lint/${commit}/Cargo.toml`,
    )).text();
    const detectedAstVersion =
      /^deno_ast *= *{ *version = *".?((\d+)\.(\d+)\.(\d+))[^"]*"/gm.exec(
        tomlConfig,
      )?.[1];
    if (!detectedAstVersion) {
      logger.warn(`Can not get deno_ast version from ${commit}/Cargo.toml`);
      continue;
    }
    if (semver.gte(astVersion, detectedAstVersion)) {
      logger.info(
        `Found astVersion ${astVersion} >= ${detectedAstVersion} on release ${release} of deno_lint`,
      );
      return release;
    } else {logger.warn(
        `Wrong ast version on release ${release} of deno_lint. Info: ${detectedAstVersion} > ${astVersion}`,
      );}
  }
  throw new Error(
    `Could not find matching lint version for deno_ast ${astVersion} in  deno_lint`,
  );
};

/**
 * unyt-org/deno
 */
logger.info("Migrating to deno tag", denoTag);
const latestDenoCommit = denoTag.length == 40
  ? denoTag
  : await getCommitForRelease("denoland/deno", denoTag);
logger.info("Latest commit hash for denoland/deno", latestDenoCommit);

await rebaseRepo("denoland/deno", "deno", latestDenoCommit);

/**
 * unyt-org/deno_ast
 */
const denoCargoConfig = Deno.readTextFileSync("deno/Cargo.toml");
const denoAstVersion =
  // { version = "x.y.z" }
  /^deno_ast *= *{ *version = *".?((\d+)\.(\d+)\.(\d+))[^"]*"/gm.exec(
    denoCargoConfig,
  )?.[1] ??
  // = "x.y.z"
  /^deno_ast *= *".?((\d+)\.(\d+)\.(\d+))"/gm.exec(denoCargoConfig)?.[1];
if (!denoAstVersion) {
  throw new Error("Can not get deno_ast version from Cargo.toml");
}
logger.info("Using deno_ast version", denoAstVersion);
const denoAstCommit = await getCommitForRelease(
  "denoland/deno_ast",
  denoAstVersion,
);
logger.info("Latest commit hash for deno_ast", denoAstCommit);
await rebaseRepo("denoland/deno_ast", "deno_ast", denoAstCommit);

/**
 * unyt-org/deno_lint
 */
const denoCLICargoConfig = Deno.readTextFileSync("deno/cli/Cargo.toml");
const denoLintVersion =
  // { version = "x.y.z" }
  /^deno_lint *= *{ *version = *".?((\d+)\.(\d+)\.(\d+))[^"]*"/gm.exec(
    denoCLICargoConfig,
  )?.[1] ??
  // = "x.y.z"
  /^deno_lint *= *".?((\d+)\.(\d+)\.(\d+))"/gm.exec(denoCLICargoConfig)?.[1];
if (!denoLintVersion) {
  throw new Error("Can not get deno_lint version from Cargo.toml");
}
logger.info("Using deno_lint version", denoLintVersion);
const denoLintCommit = await getCommitForRelease(
  "denoland/deno_lint",
  denoLintVersion,
);
logger.info("Latest commit hash for deno_lint", denoLintCommit);
await rebaseRepo("denoland/deno_lint", "deno_lint", denoLintCommit);

await exec("git status", { cwd: "deno" });
await exec("git status", { cwd: "deno_ast" });
await exec("git status", { cwd: "deno_lint" });

await Promise.all([
  exec("git push origin main --force", { cwd: "deno_ast" }),
  exec("git push origin main --force", { cwd: "deno_lint" }),
]);

await exec("cargo update", { cwd: "deno" });
await exec("git add Cargo.lock", { cwd: "deno" });
await exec("git commit -m Dependencybump", { cwd: "deno" });
await exec("git push origin main --force", { cwd: "deno" });

logger.info("Successfully rebased the core repos");
