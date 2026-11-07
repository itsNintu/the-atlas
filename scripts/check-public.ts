import { readFileSync } from "node:fs";
const proc = Bun.spawn(["git", "ls-files", "-z"], { stdout: "pipe" });
const files = (await new Response(proc.stdout).text()).split("\0").filter(Boolean);
if (await proc.exited) throw Error("git ls-files failed");
const rules: [string, RegExp][] = [
  ["the-atlas_token", /ta_[A-Za-z0-9_-]{40,}/],
  ["github_token", /gh[pousr]_[A-Za-z0-9]{25,}/],
  ["openai_key", /sk-(?:proj-)?[A-Za-z0-9_-]{30,}/],
  ["private_key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];
const findings: {file:string;rule:string}[] = [];
for (const file of files) {
  if (/(^|\/)(?:data|\.private[^/]*|node_modules)\//.test(file) || /\.(?:sqlite(?:-wal|-shm)?|credentials\.json)$/.test(file) || /(^|\/)\.env(?:$|\.)/.test(file) && !file.endsWith(".env.example")) findings.push({file,rule:"private_path"});
  if (file.endsWith(".png")) continue;
  const content = readFileSync(file,"utf8");
  for (const [rule,pattern] of rules) if(pattern.test(content)) findings.push({file,rule});
}
console.log(JSON.stringify({result: findings.length?"fail":"pass",tracked_files:files.length,findings,note:"Targeted known-token/private-path check, not a guarantee of complete secret detection; manually inspect public changes too."},null,2));
if(findings.length)process.exitCode=1;
