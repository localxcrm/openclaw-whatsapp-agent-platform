# v0.8.0 — WhatsApp Agent Platform GUI

Primeira publicação pública da distribuição aprovada.

- Gerenciador somente nos detalhes de WhatsApp Agent Platform em Settings → Channels.
- Adicionar vínculo com agente existente e API referenciada no cofre protegido.
- Alterar responsável, sessão e estado ativo; remover vínculo sem apagar o agente.
- Instalador com verificação de compatibilidade e assets versionados contra cache antigo.
- README, guia de configuração/uso, código TypeScript, testes e licença MIT.

**Requisito da GUI: OpenClaw 2026.9.3 + Node.js 24+.** Instale pelo ZIP completo;
o arquivo `.tgz` sozinho não instala a integração de Channels.

O ZIP é o mesmo artefato aprovado antes da publicação. A documentação atualizada
está no README e em docs/CONFIGURATION.md. Nenhuma conta ou credencial real incluída.

Validação: 38 testes, tipagem e build com dependências locais; navegador com dados
fictícios/cache antigo e instalador em cópia isolada do host. Instalação limpa de
dependências de desenvolvimento bloqueada por iconv-lite@~0.8.0 indisponível;
sem afirmação de CI verde ou teste em um segundo computador.
