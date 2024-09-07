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

const latestDenoTag = (await requestGithubAPI<{ tag_name: string}>(`/releases/latest`)).tag_name;
logger.info("Latest deno tag", latestDenoTag);
const latestDenoCommit = await getCommitForRelease("denoland/deno", latestDenoTag);
logger.info("Latest commit hash for denoland/deno", latestDenoCommit);

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

	logger.info(`Successfully rebased ${repo} to commit ${commit}`);}

await rebaseRepo("denoland/deno", "deno");

const tomlConfig = Deno.readTextFileSync("deno/Cargo.toml");
const denoAstVersion = /^deno_ast *= *{ *version = *".?((\d+)\.(\d+)\.(\d+))[^"]*"/gm.exec(tomlConfig)?.[1];
if (!denoAstVersion)
	throw new Error("Can not get deno_ast version from Cargo.toml");

const denoAstCommit = await getCommitForRelease("denoland/deno_ast", denoAstVersion);
logger.info("Latest commit hash for deno_ast", denoAstCommit);

await rebaseRepo("denoland/deno_ast", "deno_ast", denoAstCommit);


// await rebaseRepo("denoland/deno_lint", "deno_lint");