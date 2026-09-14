import { readFileSync, writeFileSync, mkdirSync, copyFileSync, renameSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync, brotliCompressSync } from 'node:zlib';
const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(process.env.CHANNELS_UI_ROOT);
const assets=resolve(root,'assets');
const indexPath=resolve(root,'index.html');
const original=readFileSync(indexPath,'utf8');
const sourcePage=readFileSync(resolve(here,'dist/channels-settings/channels-page-BfgN5gDl.js'),'utf8');
// Keep account management inside the selected plugin, never on the channel overview.
const page=sourcePage.replace('${!s?waSettingsPanel(e):C}', '');
if (!page.includes('e.channelId===`whatsapp-agent`?waSettingsPanel(e.props):C')) throw Error('Plugin detail integration missing');
if(!page.includes('// whatsapp-agent Channels integration v1')) throw Error('Expected Channels integration is missing; refusing update');
const manager=readFileSync(resolve(here,'dist/channels-settings/whatsapp-channels-settings.js'),'utf8');
const css=readFileSync(resolve(here,'dist/channels-settings/whatsapp-channels-settings.css'));
const revision=createHash('sha256').update(page).update(manager).update(css).digest('hex').slice(0,12);
const prefix=`whatsapp-ui-${revision}`;
const entry=`${prefix}-entry.js`;
const managerName=`${prefix}-manager.js`;
const cssName=`${prefix}.css`;
const pageName=`${prefix}-channels.js`;
// Load the corrected page before the app's lazy route can register an older cached page.
// All other host modules keep their original URLs and module identity.
const bootstrap=`await import("./${pageName}");\nawait import("./index-CbXUwLqm.js");\n`;
if(!/src="\.\/assets\/(?:index-CbXUwLqm|whatsapp-ui-[a-f0-9]+-entry)\.js"/.test(original)) throw Error('Host entry changed; refusing update');
const patched=original.replace(/src="\.\/assets\/(?:index-CbXUwLqm|whatsapp-ui-[a-f0-9]+-entry)\.js"/,`src="./assets/${entry}"`);
if(patched===original && !original.includes(entry)) throw Error('Entry substitution failed');
const output=resolve(here,'dist/cache-fix');mkdirSync(output,{recursive:true});
const files=new Map([[managerName,manager.replaceAll('whatsapp-channels-settings.css',cssName)],[cssName,css],[pageName,page.replace('./whatsapp-channels-settings.js',`./${managerName}`)],[entry,bootstrap]]);
for(const [name,data] of files) writeFileSync(resolve(output,name),data);
writeFileSync(resolve(output,'index.html'),patched);
writeFileSync(resolve(output,'manifest.json'),JSON.stringify({revision,entry,pageName,managerName,cssName},null,2));
if(!process.argv.includes('--apply')) { console.log('Staged versioned UI:',revision);process.exit(0); }
const backup=resolve(here,'backups/cache-fix-'+Date.now());mkdirSync(backup,{recursive:true});
for(const suffix of ['', '.gz','.br'])if(existsSync(indexPath+suffix))copyFileSync(indexPath+suffix,resolve(backup,'index.html'+suffix));
function publish(file,data){for(const [suffix,bytes]of [['',data],['.gz',gzipSync(data)],['.br',brotliCompressSync(data)]]){writeFileSync(file+suffix+'.tmp',bytes);renameSync(file+suffix+'.tmp',file+suffix);}}
for(const [name,data]of files)publish(resolve(assets,name),Buffer.from(data));
publish(indexPath,Buffer.from(patched));
console.log('Published versioned UI:',revision,'Backup:',backup);
