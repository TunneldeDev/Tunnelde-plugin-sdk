import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
await mkdir('artifacts',{recursive:true});
const [{filename}]=JSON.parse(execFileSync('npm',['pack','--json','--pack-destination','artifacts'],{encoding:'utf8'}));
const bytes=await readFile(`artifacts/${filename}`);
await writeFile('artifacts/SHA256SUMS',`${createHash('sha256').update(bytes).digest('hex')}  ${filename}\n`);
