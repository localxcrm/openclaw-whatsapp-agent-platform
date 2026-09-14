# WhatsApp Agent Platform — distribuição aprovada 0.8.0

Inclui plugin e integração da interface aprovada em 14/09/2026.
O gerenciador aparece somente ao abrir **Settings → Channels → WhatsApp Agent Platform**.
Lista agentes existentes e permite adicionar, editar e remover vínculos. Remover
vínculo não apaga o agente. APIs são selecionadas por referência ao cofre protegido.
Nenhuma conta, credencial, conversa, backup ou estado de Rodrigo acompanha o pacote.

## Compatibilidade

Node.js >=24. A integração visual é específica do OpenClaw **2026.9.3** e
valida também o formato dos arquivos. Não é um ponto de extensão oficial do SDK.
Atualizações do OpenClaw podem substituí-la; outras versões exigem adaptação.
O arquivo .tgz sozinho instala apenas o plugin: use o instalador completo para
incluir a interface. Nenhum pacote foi publicado em registro público.

## Instalação

Extraia o ZIP. Informe o diretório do pacote OpenClaw instalado (aquele que contém
package.json, openclaw.mjs e dist). Não é o diretório de configuração ~/.openclaw.

```sh
node install.mjs /caminho/para/node_modules/openclaw --check
node install.mjs /caminho/para/node_modules/openclaw
```

O primeiro comando só confere compatibilidade. O segundo instala o plugin usando
o CLI oficial e aplica a interface com URLs versionadas, sem editar configurações
financeiras, contas ou credenciais. Se o plugin já estiver instalado e não precisar
ser substituído, use `--ui-only` para aplicar apenas a interface.
Depois reinicie o Gateway pelo fluxo habitual e atualize a página.
Cada instalação deve criar seus próprios agentes e configurar suas próprias APIs.

## Recuperação

A interface salva os arquivos index.html, index.html.gz e index.html.br existentes
em ui/backups/cache-fix-<data>. Para desfazer a integração visual, restaure esses
arquivos em dist/control-ui do OpenClaw e recarregue o navegador. Não remova backups
até confirmar o funcionamento. O plugin e seu transporte não são desinstalados
por essa recuperação. Os assets versionados não referenciados podem permanecer.

## Validação

38 testes unitários, tipagem e build passaram. O teste de navegador com cache antigo
passou para adicionar, editar, remover e remover o último vínculo, usando dados
fictícios. A interface local foi aprovada pelo usuário. O instalador da distribuição
foi testado em cópia isolada dos arquivos do host, sem alterar contas reais.
Não foi testada uma instalação completa em um segundo computador.
