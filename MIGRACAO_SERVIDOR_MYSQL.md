# Guia de Migração para Servidor & Configuração de Backup MySQL 5.7

Este documento explica como configurar o sistema no seu servidor de produção e ativar o **MySQL 5.7** como réplica de segurança e backup para recuperação de desastres.

---

## 1. Arquitetura Híbrida (Arquivos JSON + Réplica MySQL 5.7)

* **Armazenamento Primário (Arquivos JSON em `data/`):**
  * O sistema opera **100% de forma autônoma sem o banco de dados**, garantindo máxima velocidade, funcionamento offline e independência de serviços externos.
* **Camada de Backup & Réplica (MySQL 5.7):**
  * O MySQL 5.7 funciona de maneira **assíncrona em segundo plano** (sem travar nem atrasar requisições).
  * Sempre que uma proposta, revisão, rascunho, modelo ou usuário é salvo no disco, uma cópia espelhada é automaticamente enviada para as tabelas do MySQL 5.7.
  * Se o MySQL estiver fora do ar ou desativado, o sistema continua funcionando perfeitamente via arquivos locais.
* **Recuperação de Desastres (Disaster Recovery):**
  * Caso qualquer arquivo ou pasta seja acidentalmente apagado no servidor, um único comando (`npm run db:restore`) recria toda a pasta `data/` e seus arquivos JSON a partir do banco de dados.

---

## 2. O Que Foi Limpo para Produção

* **Tela de Login (`public/login.html`):**
  * Foram removidos todos os atalhos de teste com senhas pré-preenchidas e botões de login direto.
  * O formulário agora é limpo e seguro, exigindo que o usuário digite suas credenciais.
* **Propostas de Teste:**
  * Propostas de teste antigas (ex: `cc_320_-_teste_01...`) foram removidas.

---

## 3. Passo a Passo para Configurar o MySQL 5.7 no Servidor

### Passo 1: Criar o Banco de Dados (Opcional - o sistema pode criar sozinho)
Você pode importar o arquivo [`database.sql`](file:///c:/Users/Tiago/Downloads/Gerador%20de%20pedido/database.sql) no seu phpMyAdmin, MySQL Workbench ou via terminal:
```bash
mysql -u root -p < database.sql
```
*(Nota: se o seu usuário MySQL tiver permissão de `CREATE DATABASE`, o próprio sistema cria o banco e as tabelas automaticamente ao iniciar).*

### Passo 2: Configurar o Arquivo `.env`
No diretório raiz do projeto, edite o arquivo [`.env`](file:///c:/Users/Tiago/Downloads/Gerador%20de%20pedido/.env):
```env
PORT=3000

# Ativar sincronização com MySQL 5.7
DB_ENABLED=true

# Dados de conexão do MySQL 5.7
DB_HOST=localhost
DB_PORT=3306
DB_NAME=sedna_pedidos
DB_USER=seu_usuario_mysql
DB_PASSWORD=sua_senha_mysql

# Sincronização automática em segundo plano
DB_AUTO_SYNC=true
```

---

## 4. Comandos de Terminal Disponíveis

No terminal da pasta do projeto, você dispõe dos seguintes comandos:

| Comando | Descrição |
| :--- | :--- |
| `npm run db:test` | Testa a conexão com o MySQL 5.7 e exibe a versão do banco |
| `npm run db:status` | Compara a quantidade de registros no banco vs arquivos na pasta `data/` |
| `npm run db:backup` | **Faz o backup completo**: lê todos os arquivos JSON atuais e copia para o MySQL |
| `npm run db:restore` | **Recuperação de Emergência**: recria todos os arquivos JSON locais a partir do MySQL |
| `npm start` | Inicia o servidor Node.js |

---

## 5. Gerenciamento Visual pelo Painel Administrativo

Você também pode gerenciar e acompanhar o backup diretamente pelo navegador:

1. Acesse o sistema como Administrador (`admin`).
2. Clique no botão **"Usuários"** no canto superior direito.
3. No final da janela, você verá o painel **💾 Backup & Réplica de Segurança (MySQL 5.7)**:
   * **Indicador visual:** mostra se está conectado (`🟢 Conectado ao MySQL 5.7`), com erro ou desativado.
   * **Botão "Fazer Backup Completo para o MySQL Agora":** envia todos os dados locais para o banco com 1 clique.
   * **Botão "Recuperar Arquivos do Banco (Restore)":** regera os arquivos locais a partir do banco de dados.
   * **Botão "Configurar Conexão MySQL":** permite alterar host, usuário, senha e banco diretamente pela interface sem precisar editar arquivos no terminal.

---

## 6. Estrutura das Tabelas no MySQL 5.7

O banco contém 8 tabelas organizadas em `InnoDB` com `utf8mb4`:

1. `users` &mdash; Usuários, permissões de acesso e senhas.
2. `proposals` &mdash; Propostas salvas, números de pedido e histórico completo de revisões.
3. `active_proposals` &mdash; Rascunhos ativos de cada vendedor e de cada embarcação.
4. `model_templates` &mdash; Modelos e características de fábrica de cada barco.
5. `models_catalog` &mdash; Lista de embarcações disponíveis no catálogo.
6. `system_settings` &mdash; Sequenciador do número de pedidos (`PROP-2026-XXX`).
7. `sessions` &mdash; Tokens e sessões ativas.
8. `backup_logs` &mdash; Auditoria e registro de execuções de backup e restaurações.
