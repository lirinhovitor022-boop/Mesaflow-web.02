# MesaFlow

Sistema web responsivo para operação de restaurante. O aplicativo usa Node.js e PostgreSQL, com login de administrador e dados persistidos no servidor.

## Recursos

- Login com senha protegida por hash, sessão HTTP-only e formulário para alterar a senha.
- Configuração protegida da primeira conta de administrador; cadastro público fica desativado.
- Dados do restaurante: nome, razão social, CNPJ, inscrição estadual, contato, endereço e taxa de serviço.
- Cadastro de mesas, pedidos, cardápio, fichas técnicas, estoque, pagamentos demonstrativos e relatórios.
- Dados separados por conta e salvos no PostgreSQL; alterações concorrentes são detectadas para evitar sobrescrita silenciosa.
- Exportação de uma cópia JSON pelo aplicativo.

## Publicar no Render

1. Envie este projeto para um repositório GitHub seu.
2. No Render, crie um banco de dados PostgreSQL. Para não perder os dados, escolha uma opção com persistência adequada à produção e mantenha o banco ativo.
3. Crie um **Web Service** apontando para o repositório. Configure:
   - Runtime: `Node`
   - Build command: `npm install`
   - Start command: `npm start`
   - Health check path: `/api/health`
4. Configure as variáveis privadas do serviço:
   - `NODE_ENV` = `production`
   - `DATABASE_URL` = URL interna do PostgreSQL do Render
   - `SESSION_SECRET` = valor aleatório secreto com pelo menos 32 caracteres
   - `SETUP_KEY` = valor aleatório secreto diferente, com pelo menos 24 caracteres
5. Publique o serviço. Na primeira visita, use a tela de configuração e informe a `SETUP_KEY` definida nas variáveis do serviço, o nome do restaurante e as credenciais do administrador.
6. Depois de criar a conta, a configuração inicial é bloqueada. Guarde a senha e não compartilhe a chave de configuração.

Não coloque segredos no repositório. No Render, defina-os em **Environment**. A URL pública só estará disponível depois que o serviço concluir a publicação.

## Executar localmente

É necessário ter Node.js 20+ e PostgreSQL instalado e ativo.

1. Crie um banco PostgreSQL chamado `mesaflow`.
2. Copie `.env.example` para `.env` e ajuste `DATABASE_URL`, `SESSION_SECRET` e `SETUP_KEY` para valores locais aleatórios.
3. Execute:

```bash
npm install
npm start
```

4. Abra `http://localhost:8000` e crie a primeira conta com a chave definida em `.env`.

O servidor cria as tabelas necessárias ao iniciar. O navegador sozinho não inicia o backend e `python -m http.server` não substitui `npm start`.

## Limites desta versão

Pagamentos, emissão de documentos fiscais e conciliação bancária continuam demonstrativos. Integração real exige provedores e credenciais próprias. Esta primeira configuração tem uma única conta de administrador por banco; não há contas separadas para funcionários, recuperação automática de senha, nem sincronização em tempo real de alterações entre sessões. O banco contém os dados reais do restaurante: configure backups e permissões de acesso no Render.
