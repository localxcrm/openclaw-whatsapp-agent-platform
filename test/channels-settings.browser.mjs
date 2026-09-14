import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { strict as assert } from 'node:assert';

// Isolated UI fixture: never connects to the live gateway or changes real accounts.
const server = createServer(async (req, res) => {
  if (req.url === '/settings/channels') {
    res.setHeader('content-type', 'text/html');
    res.end('<html><body style="background:#17191c;color:#eee;font:15px sans-serif;--text:#eee;--bg:#17191c;--border:#444;--muted:#aaa;--accent:#48a2d4"><h1>Settings → Channels (test fixture)</h1><whatsapp-channels-settings></whatsapp-channels-settings><script type="module" src="/whatsapp-channels-settings.js"></script></body></html>');
    return;
  }
  const name = req.url.slice(1);
  if (!['whatsapp-channels-settings.js','whatsapp-channels-settings.css'].includes(name)) { res.writeHead(404).end(); return; }
  res.setHeader('content-type', name.endsWith('.js') ? 'text/javascript' : 'text/css');
  res.end(await readFile(new URL('../distribution/ui/dist/channels-settings/' + name, import.meta.url)));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath:process.env.CHROME_EXECUTABLE_PATH, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/settings/channels`);
  await page.evaluate(async () => {
    await customElements.whenDefined('whatsapp-channels-settings');
    window.patches = [];
    window.accounts = { admin: { agentId: 'demo-admin', apiToken: { source:'store', provider:'default', id:'EXISTING_TOKEN' } } };
    const element = document.querySelector('whatsapp-channels-settings');
    element.canAdmin = true;
    element.client = { async request(method, params) {
      if (method === 'agents.list') return { agents: [{id:'demo-admin',name:'Admin'}, {id:'demo-sales',name:'Sales'}] };
      if (method === 'config.get') return {hash:'fixture-hash', config:{ plugins:{entries:{'whatsapp-agent-admin':{config:{accounts:window.accounts}}}}}};
      if (method === 'secrets.store.list') return { entries:[{kind:'secret',name:'TEST_TOKEN'}] };
      if (method === 'config.patch') {
        const patch = JSON.parse(params.raw); window.patches.push(patch);
        for (const [id, account] of Object.entries(patch.plugins.entries['whatsapp-agent-admin'].config.accounts)) {
          if (account === null) delete window.accounts[id];
          else window.accounts[id] = {...window.accounts[id], ...account};
        }
        return {ok:true};
      }
      throw new Error('Unexpected RPC: '+method);
    }};
  });
  const panel = page.locator('whatsapp-channels-settings');
  await panel.getByRole('button',{name:'+ Add agent',exact:true}).click();
  await panel.getByLabel('Account name').fill('sales');
  await panel.getByLabel('Existing agent').selectOption('demo-sales');
  await panel.getByLabel('WhatsApp API', {exact:true}).selectOption('TEST_TOKEN');
  await panel.getByRole('button',{name:'Add mapping',exact:true}).click();
  await panel.getByRole('heading',{name:'sales',exact:true}).waitFor();
  assert.equal(await page.evaluate(() => window.accounts.sales.apiToken.source), 'store');
  await panel.getByLabel('Agent for account sales',{exact:true}).selectOption('demo-admin');
  await panel.locator('article').filter({has:page.getByRole('heading',{name:'sales',exact:true})}).getByRole('button',{name:'Save mapping'}).click();
  await page.waitForFunction(() => window.accounts.sales.agentId === 'demo-admin');
  page.on('dialog', dialog => dialog.accept());
  await panel.locator('article').filter({has:page.getByRole('heading',{name:'sales',exact:true})}).getByRole('button',{name:'Remove mapping'}).click();
  await page.waitForFunction(() => !window.accounts.sales);
  await panel.getByRole('button',{name:'Remove mapping'}).click();
  await panel.getByText('0 configured account(s).', {exact:true}).waitFor();
  assert.equal(await panel.getByRole('button',{name:'+ Add agent',exact:true}).isEnabled(),true);
  await page.evaluate(() => { document.querySelector('whatsapp-channels-settings').canAdmin = false; });
  await page.waitForFunction(() => document.querySelector('whatsapp-channels-settings').shadowRoot.querySelector('button').disabled === false && document.querySelector('whatsapp-channels-settings').shadowRoot.textContent.includes('Only administrators'));
  assert.equal(await panel.getByRole('button',{name:'+ Add agent',exact:true}).isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log('Browser PASS: add with SecretRef, change agent, remove, remove last, read-only permissions; no live data touched.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
