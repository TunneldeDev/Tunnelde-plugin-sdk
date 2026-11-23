#!/usr/bin/env node
import { checkPlugin, packagePlugin } from '../tools/plugin.mjs';
const command=process.argv[2] ?? 'check';
if(command==='check') console.log(`${(await checkPlugin()).id}: valid`);
else if(command==='package') console.log(await packagePlugin());
else if(command==='publish') { const { execFile }=await import('node:child_process'); const { promisify }=await import('node:util'); const execute=promisify(execFile); const { publishPackages }=await import('../tools/publish.mjs'); await publishPackages({tag:process.env.PACKAGE_TAG,sha:process.env.PACKAGE_SHA,prerelease:process.env.PACKAGE_PRERELEASE==='true',gh:async args=>(await execute('gh',args,{encoding:'utf8',timeout:120000,maxBuffer:2*1024*1024})).stdout}); }
else throw new Error('Usage: tunnelde-plugin check|package|publish');
