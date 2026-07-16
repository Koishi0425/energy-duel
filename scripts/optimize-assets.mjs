import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sourceRoot = path.join(root, 'art-source', 'runtime-imports');
const outputRoot = path.join(root, 'client', 'public', 'assets');
const gameConfig = JSON.parse(await readFile(path.join(root, 'shared', 'config', 'game.json'), 'utf8'));
const characterNames = new Map(gameConfig.characters.map((character) => [character.id, character.name]));

async function runFfmpeg(input, output, size, lossless = false, quality = size <= 384 ? 84 : 88) {
  await mkdir(path.dirname(output), { recursive: true });
  const temporary = `${output}.tmp.webp`;
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vf', `scale=${size}:${size}:force_original_aspect_ratio=decrease`, '-c:v', 'libwebp', '-compression_level', '6'];
  if (lossless) args.push('-lossless', '1'); else args.push('-quality', String(quality), '-preset', 'picture');
  args.push('-pix_fmt', 'yuva420p', temporary);
  await new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: 'inherit' });
    child.once('error', reject); child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`)));
  });
  const contents = await readFile(temporary);
  const hash = createHash('sha256').update(contents).digest('hex').slice(0, 12);
  const hashedOutput = output.replace(/\.webp$/, `.${hash}.webp`);
  await writeFile(hashedOutput, contents);
  await unlink(temporary);
  return { path: hashedOutput, hash, bytes: contents.length };
}

function publicUrl(file) { return `/${path.relative(path.join(root, 'client', 'public'), file).split(path.sep).join('/')}`; }
function stableId(prefix, label) { return `${prefix}-${createHash('sha256').update(label, 'utf8').digest('hex').slice(0, 10)}`; }

async function optimizeCharacters() {
  const directory = path.join(sourceRoot, 'characters');
  const entries = await readdir(directory, { withFileTypes: true });
  const assets = [];
  for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const input = path.join(directory, entry.name, 'portrait.png');
    const destination = path.join(outputRoot, 'characters', entry.name, 'base');
    const full = await runFfmpeg(input, path.join(destination, 'portrait.webp'), 1024);
    const preview = await runFfmpeg(input, path.join(destination, 'preview.webp'), 384);
    const id = entry.name === 'default_character' ? 'portrait_default' : `portrait_${entry.name}`;
    assets.push({ id, type: 'character-portrait', characterId: entry.name, formId: 'base', name: characterNames.get(entry.name) ?? entry.name, url: publicUrl(full.path), previewUrl: publicUrl(preview.path), bytes: full.bytes, previewBytes: preview.bytes });
  }
  return assets;
}

async function optimizeNameplates() {
  const directory = path.join(sourceRoot, 'profiles', 'nameplates');
  const entries = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png')).sort((a, b) => a.name.localeCompare(b.name));
  const assets = [];
  for (const entry of entries) {
    const label = path.parse(entry.name).name; const id = stableId('nameplate', label); const destination = path.join(outputRoot, 'profiles', 'nameplates', id);
    const frame = await runFfmpeg(path.join(directory, entry.name), path.join(destination, 'frame.webp'), 720, false, 90);
    const thumbnail = await runFfmpeg(path.join(directory, entry.name), path.join(destination, 'thumbnail.webp'), 320, false, 86);
    assets.push({ id, type: 'nameplate', name: label, url: publicUrl(frame.path), previewUrl: publicUrl(thumbnail.path), width: 720, height: 116, status: 'testing', bytes: frame.bytes, previewBytes: thumbnail.bytes });
  }
  return assets;
}

async function optimizeTitles() {
  const directory = path.join(sourceRoot, 'profiles', 'titles');
  const entries = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png')).sort((a, b) => a.name.localeCompare(b.name));
  const assets = [];
  for (const entry of entries) {
    const label = path.parse(entry.name).name.replace(/^UI_CMN_Shougou_/i, ''); const id = `title-${label.toLowerCase()}`; const destination = path.join(outputRoot, 'profiles', 'titles', id);
    const badge = await runFfmpeg(path.join(directory, entry.name), path.join(destination, 'badge.webp'), 276, true);
    assets.push({ id, type: 'title-badge', name: label, url: publicUrl(badge.path), width: 276, height: 36, status: 'unregistered', bytes: badge.bytes });
  }
  return assets;
}

for (const generatedDirectory of [
  path.join(outputRoot, 'characters'),
  path.join(outputRoot, 'profiles', 'nameplates'),
  path.join(outputRoot, 'profiles', 'titles'),
  path.join(outputRoot, 'manifests'),
]) await rm(generatedDirectory, { recursive: true, force: true });

const assets = [...await optimizeCharacters(), ...await optimizeNameplates(), ...await optimizeTitles()];
const manifestDirectory = path.join(outputRoot, 'manifests'); await mkdir(manifestDirectory, { recursive: true });
await writeFile(path.join(manifestDirectory, 'assets.json'), `${JSON.stringify({ version: 1, generatedAt: new Date().toISOString(), assets }, null, 2)}\n`, 'utf8');
const nameplates = assets.filter((asset) => asset.type === 'nameplate').map((asset) => ({ id: asset.id, name: asset.name, description: '测试期间开放使用。', assetUrl: asset.url, previewUrl: asset.previewUrl }));
const titleBadges = Object.fromEntries(assets.filter((asset) => asset.type === 'title-badge').map((asset) => [asset.name.toLowerCase(), asset.url]));
const profileAssets = {
  version: 1,
  nameplates,
  titleRarities: {
    normal: { name: '普通', assetUrl: titleBadges.normal },
    bronze: { name: '铜', assetUrl: titleBadges.bronze },
    silver: { name: '银', assetUrl: titleBadges.silver },
    gold: { name: '金', assetUrl: titleBadges.gold },
    rainbow: { name: '彩', assetUrl: titleBadges.rainbow },
  },
};
await writeFile(path.join(root, 'shared', 'config', 'profile-assets.json'), `${JSON.stringify(profileAssets, null, 2)}\n`, 'utf8');
const runtimeBytes = assets.reduce((sum, asset) => sum + (asset.bytes ?? 0) + (asset.previewBytes ?? 0), 0);
console.log(`Optimized ${assets.length} assets (${(runtimeBytes / 1024 / 1024).toFixed(2)} MiB runtime output).`);
