import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packagePlugin, verifyArchive, inspectArchive, hash, validateEntry } from '../tools/plugin.mjs';
test('standalone package validates metadata, determinism and immutable resource identity',async t=>{
 const root=await mkdtemp(join(tmpdir(),'plugin-kit-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const manifest={id:'example',name:'Example',description:'Test standalone packaging',author:'TunneldeDev',version:'1.0.0',apiVersion:1,runtime:'node',main:'index.mjs',readme:'README.md',permissions:[]};
 for(const [name,value] of Object.entries({'package.json':JSON.stringify({repository:'https://github.com/TunneldeDev/example'}),'tunnelde-plugin.json':JSON.stringify(manifest),'index.mjs':'export const value=1;','README.md':'Standalone plugin documentation and installation instructions. '.repeat(3)})) await writeFile(join(root,name),value);
 const a=await packagePlugin({root});const bytes=await readFile(join(root,'artifacts/example-1.0.0.zip'));
 const b=await packagePlugin({root});assert.deepEqual(a,b);assert.equal(verifyArchive(bytes,a).id,'example');
 assert.throws(()=>verifyArchive(bytes,{...a,sha256:'0'.repeat(64)}));
 assert.throws(()=>verifyArchive(bytes,{...a,name:'forged'}));
 assert.throws(()=>validateEntry({...a,url:a.url.replace('v1.0.0','latest')}));
 const bad=Buffer.from(bytes);const central=bad.indexOf(Buffer.from([0x50,0x4b,0x01,0x02]));bad.write('../oops',central+46,'utf8');
 assert.throws(()=>inspectArchive(bad),/Unsafe/);
 const corrupt=Buffer.from(bytes);corrupt[40]^=1;assert.throws(()=>verifyArchive(corrupt,{...a,sha256:hash(corrupt)}));
});
