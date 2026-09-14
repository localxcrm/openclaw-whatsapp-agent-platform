import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const here=dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
const rootArg=args.find(x=>!x.startsWith('--'));
if (!rootArg || args.some(x=>x.startsWith('--')&&!['--check','--ui-only'].includes(x))) throw Error('Usage: node install.mjs /absolute/path/to/openclaw [--check | --ui-only]');
const root=resolve(rootArg);
const pkg=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
if(pkg.name!=='openclaw'||pkg.version!=='2026.9.3') throw Error('This UI integration supports OpenClaw 2026.9.3 only. No changes made.');
const uiRoot=resolve(root,'dist/control-ui');
const env={...process.env,CHANNELS_UI_ROOT:uiRoot};
function run(file, argv, extra={}) { const r=spawnSync(file,argv,{stdio:'inherit',env,...extra}); if(r.error)throw r.error;if(r.status!==0)throw Error('Installation step failed: '+file+' (exit '+r.status+')'); }
// Both scripts stage first and reject incompatible host layouts before any live change.
run(process.execPath,[resolve(here,'ui/install-channels-ui.mjs')]);
run(process.execPath,[resolve(here,'ui/install-channels-cache-fix.mjs')]);
if(args.includes('--check')) {console.log('Compatibility check passed; live installation unchanged.');process.exit(0);}
if(!args.includes('--ui-only')) {
 const cli=resolve(root,'openclaw.mjs');
 if(!existsSync(cli))throw Error('OpenClaw CLI entry missing; no installation performed.');
 run(process.execPath,[cli,'plugins','install',resolve(here,'openclaw-whatsapp-agent-platform-0.8.0.tgz')]);
}
run(process.execPath,[resolve(here,'ui/install-channels-cache-fix.mjs'),'--apply']);
console.log('UI installed. Restart the Gateway when appropriate, reload Settings → Channels and open WhatsApp Agent Platform. Existing accounts/credentials were not copied into this distribution.');
