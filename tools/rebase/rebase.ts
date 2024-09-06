#!/usr/bin/env -S deno run -A --lock=tools/deno.lock.json

const GITHUB_BASE_URL = "https://api.github.com/repos";
const GITHUB_TOKEN = Deno.env.get("GITHUB_TOKEN");

const requestGithubAPI = async <T>(route: string, repo = "denoland/deno") => {
	const request = (await fetch(`${GITHUB_BASE_URL}/${repo}${route}`, GITHUB_TOKEN ? {
		headers: { 
			"Authorization": `Bearer ${GITHUB_TOKEN}`
		}
	} : undefined));
	if (!request.ok)
		throw new Error("Request error: " + request.statusText);
	return await request.json() as T;
}

const latestDenoTag = (await requestGithubAPI<{ tag_name: string}>(`/releases/latest`)).tag_name;
console.info("Latest deno tag", latestDenoTag);

const latestCommitHash = (await requestGithubAPI<{ object: { sha: string} }>(`/git/ref/tags/${latestDenoTag}`)).object.sha;
console.info("Latest commit hash", latestCommitHash);

const exec = async (command: string, cwd?: string) =>
	await new Deno.Command(command.split(" ")[0], { stdin: "piped", args: command.split(' ').slice(1), cwd: cwd})
		.spawn().output();

const rebaseRepo = async (repo: string, directory: string, commit: string = "upstream/main") => {
	try {
		await exec(`git remote add upstream https://github.com/${repo}.git`);
	} catch {
		console.debug("Git remote upstream does already exist");
	}

	await exec(`git checkout -b draft-${Math.random()*10000} ${commit}`);
	await exec("git fetch upstream", directory);
	await exec(`git rebase ${commit}`, directory);
	await exec("git rm Cargo.lock", directory);
	await exec("git -c core.editor=true rebase --continue", directory);

	console.info("Successfully rebased", repo);
}

await rebaseRepo("denoland/deno", "deno");

const tomlConfig = Deno.readTextFileSync("deno/Cargo.toml");
const denoAstVersion = /^deno_ast *= *{ *version = *".?((\d+)\.(\d+)\.(\d+))[^"]*"/gm.exec(tomlConfig)?.[1];
if (!denoAstVersion)
	throw new Error("Can not get deno_ast version from Cargo.toml");

const denoAstCommit = (await requestGithubAPI<{ object: { sha: string} }>(`/git/ref/tags/${denoAstVersion}`, "denoland/deno_ast")).object.sha;
console.info("Latest commit hash for deno_ast", denoAstCommit);


await rebaseRepo("denoland/deno_ast", "deno_ast", denoAstCommit);


// await rebaseRepo("denoland/deno_lint", "deno_lint");