import { createHash } from "node:crypto";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { readdirSync, existsSync, readFileSync } from "node:fs";
import { catalogueTags } from "./tags.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function canonicalBytes(name, bytes) {
  if (
    !/(?:\.(?:json|md|mjs|js|ts|css|html|txt|svg|ya?ml)|(?:^|\/)LICENSE)$/i.test(
      name,
    )
  )
    return bytes;
  const text = bytes.toString("utf8");
  if (!Buffer.from(text, "utf8").equals(bytes)) return bytes;
  return Buffer.from(text.replaceAll("\r\n", "\n"), "utf8");
}

async function collect(directory, base = directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Plugin package must not contain symbolic links");
    if (entry.isDirectory()) files.push(...(await collect(path, base)));
    else if (entry.isFile())
      files.push({
        name: relative(base, path).replaceAll("\\", "/"),
        bytes: canonicalBytes(entry.name, await readFile(path)),
      });
  }
  return files;
}

/** Minimal ZIP writer: fixed DOS epoch, stable names, UTF-8, deflate, no platform extra fields. */
export async function buildPluginArchive(directory) {
  const localParts = [],
    centralParts = [];
  let offset = 0;
  const files = await collect(directory);
  if (!files.some((file) => file.name === "LICENSE"))
    files.push({
      name: "LICENSE",
      bytes: canonicalBytes("LICENSE", await readFile(join(repository, "LICENSE"))),
    });
  files.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const compressed = deflateRawSync(file.bytes, { level: 9 });
    const checksum = crc32(file.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(33, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(file.bytes.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt16LE(33, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(file.bytes.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, central, end]);
}

