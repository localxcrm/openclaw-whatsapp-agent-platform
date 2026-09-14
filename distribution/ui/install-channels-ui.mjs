import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, renameSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// Version-scoped local UI patch. Refuses changed host layouts; never edits config or secrets.
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(process.env.CHANNELS_UI_ROOT);
const apply = process.argv.includes('--apply');
const file = resolve(root, 'assets/channels-page-BfgN5gDl.js');
const original = readFileSync(file, 'utf8');
const marker = '// whatsapp-agent Channels integration v1';
if (original.includes(marker)) { writeFileSync(resolve(here,'dist/channels-settings/channels-page-BfgN5gDl.js'), original.replace('${!s?waSettingsPanel(e):C}', '')); console.log('Existing integration staged.'); process.exit(0); }
const edits = [
  ['Yt({connected:t.connected', 'Yt({whatsappGatewayClient:e.gateway.snapshot.client,connected:t.connected'],
  ['function Yt(e){let t=Zt(e.snapshot)', 'function Yt(e){let t=Zt(e.snapshot)'],
  ['<div class="channels-detail__body">', '<div class="channels-detail__body">\n          ${e.channelId===`whatsapp-agent`?waSettingsPanel(e.props):C}'],
];
let patched = original;
for (const [before, after] of edits) {
  if (patched.split(before).length !== 2) throw new Error('Host layout changed; refusing to patch: '+before);
  patched = patched.replace(before, after);
}
patched = `import "./whatsapp-channels-settings.js";\n${marker}\n` + patched;
patched += '\nfunction waSettingsPanel(e){return x`<section aria-label="WhatsApp por agente">${e.configFormDirty?x`<p class="callout warn">Salve ou recarregue as alterações de configuração antes de editar os vínculos.</p>`:C}<whatsapp-channels-settings .client=${e.whatsappGatewayClient} .canAdmin=${e.canAdmin&&!e.configFormDirty}></whatsapp-channels-settings></section>`;}\n';
const staged = resolve(here,'dist/channels-settings/channels-page-BfgN5gDl.js');
writeFileSync(staged, patched);
if (!apply) { console.log('Staged Channels page; live installation unchanged.'); process.exit(0); }
const backup = resolve(here, 'backups/channels-ui-'+Date.now());
mkdirSync(backup, { recursive:true });
for (const suffix of ['', '.gz', '.br']) if (existsSync(file+suffix)) copyFileSync(file+suffix,resolve(backup,'channels-page-BfgN5gDl.js'+suffix));
writeFileSync(resolve(backup,'manifest.json'),JSON.stringify({file,sha256:createHash('sha256').update(original).digest('hex'),created:new Date().toISOString()},null,2));
function publish(target, contents) {
  writeFileSync(target+'.tmp',contents); renameSync(target+'.tmp',target);
  writeFileSync(target+'.gz.tmp',gzipSync(contents)); renameSync(target+'.gz.tmp',target+'.gz');
  writeFileSync(target+'.br.tmp',brotliCompressSync(contents)); renameSync(target+'.br.tmp',target+'.br');
}
for (const name of ['whatsapp-channels-settings.js','whatsapp-channels-settings.css']) publish(resolve(root,'assets',name),readFileSync(resolve(here,'dist/channels-settings',name)));
publish(file,Buffer.from(patched));
console.log('Installed Channels UI integration. Backup: '+backup);
