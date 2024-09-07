#!/usr/bin/env -S deno run -A --lock=tools/deno.lock.json
import Logger from "https://deno.land/x/logger@v1.1.6/logger.ts";
const logger = new Logger();

const GITHUB_BASE_URL = "https://api.github.com/repos";
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN");

logger.info("Starting rebase action...");
!GITHUB_TOKEN && logger.warn("No GITHUB_TOKEN configured: You may want to add the token as repository secret.");

const requestGithubAPI = async <T>(route: string, repo = "denoland/deno") => {
	const request = (await fetch(`${GITHUB_BASE_URL}/${repo}${route}`, GITHUB_TOKEN ? {
		headers: { 
			"Authorization": `Bearer ${GITHUB_TOKEN}`
		}
	} : undefined));
	if (!request.ok) {
		let message: string = undefined!;
		try {
			message = (await request.json()).message;
		} catch { /**/ }
		if (message)
			throw new Error(`[Request error] ${request.status}: ${message ?? request.statusText ?? "empty"}"`);
		throw new Error(`[Request error] ${request.status}: ${request.statusText ?? "empty"}"`);
	}
	return await request.json() as T;
}

const getCommitForRelease = async (repo: string, release: string) => {
	try {
		const { type, sha } = (await requestGithubAPI<{ object: { type: "commit" | string, sha: string} }>(`/git/ref/tags/${release}`, repo)).object;
		const latestHash = type === "commit" ? 
			sha :
			(await requestGithubAPI<{ object: { sha: string} }>(`/git/tags/${sha}`, repo)).object.sha;
		if (!latestHash)
			throw new Error();
		return latestHash;
	} catch {
		throw new Error(`Could not get commit for release '${release}' for ${repo}`);
	}
}
const getLatestTag = async (repo?: string) =>
	(await requestGithubAPI<{ tag_name: string}>(`/releases/latest`, repo)).tag_name;


const exec = async (command: string, args: Deno.CommandOptions) =>
	await new Deno.Command(command.split(" ")[0], { stdout: "inherit", stderr: "inherit", args: command.split(' ').slice(1), ...args})
		.spawn().output();

const rebaseRepo = async (repo: string, directory: string, commit: string = "upstream/main") => {
	logger.info(`Rebasing ${repo} to commit ${commit}...`);
	try {
		await exec(`git remote add upstream https://github.com/${repo}.git`, { stderr: "null", cwd: directory});
	} catch {
		logger.warn(`Remote upstream for ${repo} does already exist`);
	}
	await exec("git fetch upstream", {cwd: directory, stdout: "null"});
	await exec(`git rebase ${commit}`, {cwd: directory});
	await exec("git rm Cargo.lock", {cwd: directory});
	await exec("git -c core.editor=true rebase --continue", {cwd: directory});

	logger.info(`Successfully rebased ${repo} to commit ${commit}`);
}

/**
 * unyt-org/deno
 */
const latestDenoTag = await getLatestTag();
logger.info("Latest deno tag", latestDenoTag);
const latestDenoCommit = await getCommitForRelease("denoland/deno", latestDenoTag);
logger.info("Latest commit hash for denoland/deno", latestDenoCommit);
await rebaseRepo("denoland/deno", "deno", latestDenoCommit);


/**
 * unyt-org/deno_ast
 */
const denoCargoConfig = Deno.readTextFileSync("deno/Cargo.toml");
const denoAstVersion1 = /^deno_ast *= *{ *version = *".?((\d+)\.(\d+)\.(\d+))[^"]*"/gm.exec(denoCargoConfig)?.[1];
if (!denoAstVersion1)
	throw new Error("Can not get deno_ast version from Cargo.toml");
logger.info("Using deno_ast version", denoAstVersion1);
const denoAstCommit = await getCommitForRelease("denoland/deno_ast", denoAstVersion1);
logger.info("Latest commit hash for deno_ast", denoAstCommit);
await rebaseRepo("denoland/deno_ast", "deno_ast", denoAstCommit);


/**
 * unyt-org/deno_lint
 */
const latestLintTag = await getLatestTag("denoland/deno_lint");
logger.info("Latest denoland/deno_lint tag", latestLintTag);
const latestLintCommit = await getCommitForRelease("denoland/deno_lint", latestLintTag);
logger.info("Latest commit hash for denoland/deno_lint", latestLintCommit);
await rebaseRepo("denoland/deno_lint", "deno_lint", latestLintCommit);

const lintCargoConfig = Deno.readTextFileSync("deno_lint/Cargo.toml");
const denoAstVersion2 = /^deno_ast *= *{ *version = *".?((\d+)\.(\d+)\.(\d+))[^"]*"/gm.exec(lintCargoConfig)?.[1];

if (denoAstVersion1 !== denoAstVersion2)
	throw new Error(`Mismatch between the config version of denoland/deno (${denoAstVersion1}) and denoland/deno_lint (${denoAstVersion2})`)

if (false) {
	await exec("git push upstream main --force", { cwd: "deno"});
	await exec("git push upstream main --force", { cwd: "deno_ast"});
	await exec("git push upstream main --force", { cwd: "deno_lint"});
}
logger.info("Successfully rebased the core repos");