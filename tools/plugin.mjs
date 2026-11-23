import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, mkdir, cp, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { inflateRawSync } from 'node:zlib';
import { validateManifest } from '../scripts/validate.mjs';
import { buildPluginArchive } from '../scripts/plugins/package.mjs';
import { catalogueTags } from '../scripts/plugins/tags.mjs';
import { validateDependencies } from '../scripts/plugins/activation/manifest.mjs';
import { validateTags } from '../scripts/plugins/file-icons.mjs';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const maxArchive = 64 * 1024 * 1024;
const safePath = name => typeof name === 'string' && name.length > 0 && !/[\\:\x00-\x1f\x7f]/.test(name) && !name.startsWith('/') && name.split('/').every(part => part && part !== '.' && part !== '..');
export function catalogueEntry(manifest, readme, url, sha256) {
  return { id: manifest.id, name: manifest.name, version: manifest.version,
    description: manifest.description, author: manifest.author, runtime: manifest.runtime ?? 'node',
    apiVersion: manifest.apiVersion, ...(manifest.dependencies?.length ? {dependencies: manifest.dependencies} : {}),
    ...(manifest.engines ? {engines: manifest.engines} : {}), tags: catalogueTags(manifest), readme, url, sha256 };
}
export function validateEntry(entry) {
  assert.ok(entry && /^[a-z0-9][a-z0-9_-]{0,63}$/.test(entry.id), 'Invalid id');
  assert.match(entry.version, /^\d+\.\d+\.\d+$/);
  assert.match(entry.sha256, /^[a-f0-9]{64}$/);
  const url = new URL(entry.url);
  assert.ok(url.protocol === 'https:' && url.hostname === 'github.com' && !url.username && !url.password && !url.search && !url.hash, 'Expected immutable GitHub release URL');
  assert.match(url.pathname, /^\/[\w.-]+\/[\w.-]+\/releases\/download\/(?:v|plugins-v)\d+\.\d+\.\d+\/[\w.-]+\.zip$/);
  assert.equal(url.pathname.split('/').at(-1), `${entry.id}-${entry.version}.zip`);
  assert.ok(url.pathname.split('/').at(-2).endsWith(entry.version), 'Tag/version mismatch');
  assert.ok(['node','wasm','theme','declarative','frontend'].includes(entry.runtime));
  assert.ok([1,2].includes(entry.apiVersion), 'Unsupported API version');
  validateDependencies(entry);validateTags(entry.tags);
  for(const part of entry.version.split('.'))assert.ok(Number.isSafeInteger(Number(part)), 'Version component exceeds safe range');
  for (const key of ['name','description','author']) assert.ok(typeof entry[key] === 'string' && entry[key].trim() && !/[\r\n]/.test(entry[key]), `Invalid ${key}`);
  assert.ok(typeof entry.readme === 'string' && entry.readme.trim().length >= 80, 'Missing README');
  assert.ok(Array.isArray(entry.tags) && entry.tags.every(t => typeof t === 'string'), 'Invalid tags');
  return entry;
}
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let i=0;i<8;i++) value = (value>>>1) ^ (value & 1 ? 0xedb88320 : 0); }
  return (value ^ 0xffffffff) >>> 0;
}
/** Inspect bounded ZIP data without ever extracting untrusted paths. */
export function inspectArchive(bytes) {
  assert.ok(bytes.length >= 22 && bytes.length <= maxArchive, 'Archive size limit');
  const end = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(end), 0x06054b50, 'Unsupported ZIP trailer');
  assert.equal(bytes.readUInt16LE(end+4), 0); assert.equal(bytes.readUInt16LE(end+6), 0);
  const count = bytes.readUInt16LE(end+10);
  assert.equal(bytes.readUInt16LE(end+8), count);
  assert.ok(count > 0 && count < 65535, 'Unsupported ZIP file count');
  let cursor = bytes.readUInt32LE(end+16), total = 0;
  assert.equal(cursor + bytes.readUInt32LE(end+12), end);
  const files = new Map();
  for (let i=0;i<count;i++) {
    assert.ok(cursor+46 <= end); assert.equal(bytes.readUInt32LE(cursor), 0x02014b50);
    const flags=bytes.readUInt16LE(cursor+8), method=bytes.readUInt16LE(cursor+10);
    assert.ok((flags & ~0x800) === 0 && [0,8].includes(method), 'Unsupported ZIP flags/compression');
    const compressed=bytes.readUInt32LE(cursor+20), size=bytes.readUInt32LE(cursor+24);
    const n=bytes.readUInt16LE(cursor+28), extra=bytes.readUInt16LE(cursor+30), comment=bytes.readUInt16LE(cursor+32);
    assert.ok(cursor+46+n+extra+comment<=end);
    const raw=bytes.subarray(cursor+46,cursor+46+n), name=raw.toString('utf8');
    assert.ok(raw.equals(Buffer.from(name)) && safePath(name) && !files.has(name), 'Unsafe or duplicate archive path');
    assert.ok(((bytes.readUInt32LE(cursor+38)>>>16)&0xf000) !== 0xa000, 'Symbolic links are forbidden');
    total += size; assert.ok(total <= 256*1024*1024 && size <= 64*1024*1024, 'Uncompressed archive limit');
    const local=bytes.readUInt32LE(cursor+42);
    assert.ok(local+30 <= bytes.readUInt32LE(end+16)); assert.equal(bytes.readUInt32LE(local),0x04034b50);
    assert.equal(bytes.readUInt16LE(local+6),flags); assert.equal(bytes.readUInt16LE(local+8),method);
    assert.equal(bytes.readUInt32LE(local+18),compressed); assert.equal(bytes.readUInt32LE(local+22),size);
    const localN=bytes.readUInt16LE(local+26), localExtra=bytes.readUInt16LE(local+28);
    assert.ok(bytes.subarray(local+30,local+30+localN).equals(raw), 'ZIP filename mismatch');
    const start=local+30+localN+localExtra;
    assert.ok(start+compressed<=bytes.readUInt32LE(end+16));
    const packed=bytes.subarray(start,start+compressed);
    const data=method===0 ? packed : inflateRawSync(packed,{maxOutputLength:Math.max(1,size)});
    assert.equal(data.length,size); assert.equal(crc32(data),bytes.readUInt32LE(cursor+16));
    assert.equal(bytes.readUInt32LE(local+14),bytes.readUInt32LE(cursor+16));
    files.set(name,data);cursor+=46+n+extra+comment;
  }
  assert.equal(cursor,end); return files;
}
export function verifyArchive(bytes, entry) {
  validateEntry(entry); assert.equal(hash(bytes),entry.sha256,`${entry.id}: checksum mismatch`);
  const files=inspectArchive(bytes);
  for (const name of ['tunnelde-plugin.json','README.md','LICENSE']) assert.ok(files.has(name),`Missing ${name}`);
  const manifest=validateManifest(JSON.parse(files.get('tunnelde-plugin.json')),entry.id);
  const expected=catalogueEntry(manifest,files.get('README.md').toString('utf8').replaceAll('\r\n','\n'),entry.url,entry.sha256);
  assert.deepEqual(entry,expected,`${entry.id}: catalogue does not match package`);
  for(const name of [manifest.main,manifest.frontend?.entry].filter(Boolean)) assert.ok(safePath(name) && files.has(name),`Missing entry ${name}`);
  return manifest;
}
export async function downloadBytes(url, {fetcher=fetch}={}) {
  const response=await fetcher(url,{signal:AbortSignal.timeout(60000)});
  assert.ok(response.ok,`${url}: HTTP ${response.status}`);
  if(response.url) assert.equal(new URL(response.url).protocol,'https:');
  const parts=[];let size=0;
  try { for await(const part of response.body) {size+=part.length;assert.ok(size<=maxArchive,'Download exceeds 64 MiB');parts.push(part);} }
  catch(error){await response.body?.cancel().catch(()=>{});throw error;}
  return Buffer.concat(parts);
}
export async function checkPlugin(root=process.cwd()) {
  const manifest=validateManifest(JSON.parse(await readFile(join(root,'tunnelde-plugin.json'),'utf8')),JSON.parse(await readFile(join(root,'tunnelde-plugin.json'),'utf8')).id);
  assert.ok((await readFile(join(root,'README.md'),'utf8')).trim().length>=80);
  for(const name of [manifest.main,manifest.frontend?.entry].filter(Boolean)) {assert.ok(safePath(name));await readFile(join(root,name));}
  return manifest;
}
export async function packagePlugin({root=process.cwd(),repository,output=join(root,'artifacts')}={}) {
  const manifest=await checkPlugin(root);
  const pkg=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
  repository ??= pkg.repository?.url ?? pkg.repository;
  repository=repository?.replace(/^git\+/,'').replace(/\.git$/,'').replace(/\/$/,'');
  assert.match(repository ?? '',/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/,'Set package.json repository');
  const temp=await mkdtemp(join(tmpdir(),'tunnelde-package-'));
  try {
    const selected=pkg.tunnelde?.files ?? (await readdir(root)).filter(n=>!n.startsWith('.')&&!['node_modules','scripts','tests','test','artifacts','package.json','package-lock.json'].includes(n));
    for(const name of new Set([...selected,'tunnelde-plugin.json','README.md'])) {assert.ok(safePath(name));await cp(join(root,name),join(temp,name),{recursive:true,verbatimSymlinks:true});}
    const bytes=await buildPluginArchive(temp);
    assert.ok(bytes.length<=maxArchive);
    const archive=`${manifest.id}-${manifest.version}.zip`;
    const entry=catalogueEntry(manifest,(await readFile(join(temp,'README.md'),'utf8')).replaceAll('\r\n','\n'),`${repository}/releases/download/v${manifest.version}/${archive}`,hash(bytes));
    verifyArchive(bytes,entry);
    await mkdir(output,{recursive:true});
    await writeFile(join(output,archive),bytes);
    await writeFile(join(output,'marketplace.json'),JSON.stringify(entry,null,2)+'\n');
    await writeFile(join(output,'SHA256SUMS'),`${entry.sha256}  ${archive}\n`);
    return entry;
  } finally {await rm(temp,{recursive:true,force:true});}
}
