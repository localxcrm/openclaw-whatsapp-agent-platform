# Configuração e uso

## 1. Preparar OpenClaw e WhatsApp

Use OpenClaw **2026.9.3**, Node.js 24+ e acesso de administrador à Control UI.
Crie primeiro os agentes no OpenClaw e configure seus modelos e workspaces.
A GUI seleciona agentes existentes: ela não cria ou exclui agentes do OpenClaw.

Você precisa de uma credencial emitida especificamente para o **WhatsApp Agent
Platform**. Este código usa `https://api.whatsapp.com/agent/v1`; não é o canal
WhatsApp Web por QR nem uma integração com a WhatsApp Business Cloud API.
Use o fluxo oficial disponibilizado pelo WhatsApp para sua conta. A instalação
deste plugin não concede acesso à plataforma nem gera uma credencial Meta.
O portal público de emissão da credencial não foi confirmado nesta publicação.

## 2. Instalar plugin + GUI

Baixe o ZIP da [release](https://github.com/localxcrm/openclaw-whatsapp-agent-platform/releases/latest)
e extraia. Abra o terminal na pasta extraída. Informe o diretório do **pacote
OpenClaw instalado**, que contém `package.json`, `openclaw.mjs` e `dist/`.
Não use o workspace nem a pasta de configuração `~/.openclaw`.

```sh
node install.mjs /caminho/para/node_modules/openclaw --check
node install.mjs /caminho/para/node_modules/openclaw
```

Se estiver usando este repositório clonado, os mesmos arquivos ficam em
`distribution/`: execute os comandos nessa pasta. Não execute os scripts internos
da pasta `ui/` diretamente. Em instalações globais npm, `npm root -g` ajuda a
localizar a pasta; outros gerenciadores podem usar outro caminho.

`--check` apenas verifica compatibilidade. O instalador usa o CLI do OpenClaw
para instalar o plugin e adiciona a GUI com assets versionados. Para aplicar só a
interface quando o plugin já estiver instalado, use `--ui-only`.
O `.tgz` sozinho não instala a integração em Channels.

## 3. Ativar o transporte nativo

O ID interno do plugin é `whatsapp-agent-admin`, por compatibilidade histórica.
O ID do canal é `whatsapp-agent`. Na configuração de plugins do OpenClaw, habilite
o plugin e use `transport: "channel"` na raiz da configuração dele.

Em uma instalação nova, a configuração inicial do plugin é:

```json
{
  "enabled": true,
  "config": {
    "transport": "channel",
    "accounts": {}
  }
}
```

Esse objeto corresponde à entrada `plugins.entries.whatsapp-agent-admin` — não
é um arquivo completo de configuração. Use o editor de configuração do OpenClaw.
**Em instalações existentes, preserve `accounts`, referências ao cofre e estado;
não substitua as contas existentes pelo exemplo vazio.** `legacy` é o padrão do
código; o modo `channel` deve ser selecionado explicitamente para este fluxo.

Reinicie pelo fluxo habitual do OpenClaw. No CLI:

```sh
openclaw gateway restart
openclaw gateway health
```

## 4. Adicionar uma conta pela GUI

1. Abra **Settings → Channels → WhatsApp Agent Platform**.
2. Clique em **+ Adicionar agente**.
3. Em **Nome da conta**, use um identificador único, por exemplo `atendimento`.
   Use letras minúsculas, números, `_` ou `-`, começando por letra.
4. Em **Agente existente**, escolha o agente que responderá.
5. Clique em **Cadastrar API no cofre protegido**. No cofre do OpenClaw, cadastre
   um segredo como `WHATSAPP_AGENT_ATENDIMENTO_TOKEN`, insira a credencial somente
   no campo protegido e permita o host `api.whatsapp.com`.
6. Volte ao formulário, clique **Atualizar APIs**, selecione o segredo e clique
   **Adicionar vínculo**.

A GUI consulta nomes/referências dos segredos, não exibe o valor da API.
Cada instalação usa suas próprias credenciais. Referências já usadas por contas
nomeadas não são oferecidas para novas contas. Não execute dois pollers externos
usando a mesma credencial.

## 5. Editar, desativar ou remover

- **Trocar agente:** escolha outro em **Agente responsável** e clique **Salvar vínculo**.
- **Sessão:** selecione principal do agente ou isolada por contato e salve.
  Principal compartilha contexto; isolada separa os contatos.
- **Desativar:** desmarque **Conta ativa** e salve.
- **Remover:** clique **Remover vínculo** e confirme. Remove a conta do plugin,
  não o agente, histórico ou segredo no cofre. Pode remover a última conta.

Na configuração legada de conta única, adicionar/remover pode ficar indisponível;
migre para o mapa `accounts` preservando dados e referências antes de usar esse fluxo.

## 6. Testar

Pelo fluxo oficial do WhatsApp, abra a conversa do agente associado à credencial
e envie uma mensagem de teste. Confira recebimento e resposta. Status "em execução"
sozinho não comprova a troca completa. Teste mídia separadamente.
Não há envio em massa, gerenciamento de grupos ou criação de agentes Meta nesta GUI.

## Solução de problemas

| Sintoma | O que verificar |
| --- | --- |
| Só aparecem status e configurações avançadas | Instale a distribuição completa, não apenas o `.tgz`; recarregue a página e abra os detalhes do plugin. |
| Versão recusada | A GUI foi validada para 2026.9.3; não force o patch em outra versão. |
| Agente não aparece | Crie-o no OpenClaw, confira permissões e atualize a lista. |
| API não aparece | Cadastre no cofre, clique Atualizar APIs e confira se a referência já está em uso. |
| Não permite salvar | Verifique permissão admin, salve/descarte alterações pendentes na configuração nativa e atualize após conflitos. |
| Sem resposta | Confira modo channel, conta ativa, acesso à plataforma, credencial, modelo e saúde do Gateway. |

Para desfazer somente a GUI, restaure os arquivos `index.html*` preservados pelo
instalador em `ui/backups/cache-fix-*` no diretório `dist/control-ui` do host.
Atualizações do OpenClaw podem substituir o patch e exigem nova validação.
