#!/usr/bin/env node
// ========================================================
// SISTEMA GERADOR DE PEDIDOS SEDNA
// FERRAMENTA CLI DE SINCRONIZAÇÃO & RECUPERAÇÃO MYSQL 5.7
// ========================================================
// Uso:
//   node sync-db.js --backup   -> Exporta todos os arquivos JSON locais para o MySQL 5.7
//   node sync-db.js --restore  -> Recupera/Restaura os arquivos JSON a partir do MySQL 5.7
//   node sync-db.js --status   -> Verifica conexão e status do banco vs arquivos
//   node sync-db.js --test     -> Testa credenciais de conexão do MySQL
// ========================================================

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const db = require('./db');

const args = process.argv.slice(2);
const command = args[0] ? args[0].toLowerCase() : '--help';

async function main() {
  console.log('=======================================================');
  console.log('  SEDNA SPORT FISHING - BACKUP & RECUPERAÇÃO MYSQL 5.7');
  console.log('=======================================================');

  const config = db.loadConfig();
  console.log(`Configuração atual:`);
  console.log(`  - MySQL Ativo: ${config.enabled ? 'SIM' : 'NÃO (defina DB_ENABLED=true no .env)'}`);
  console.log(`  - Host: ${config.host}:${config.port}`);
  console.log(`  - Banco: ${config.database}`);
  console.log(`  - Usuário: ${config.user}`);
  console.log('-------------------------------------------------------');

  if (command === '--help' || command === '-h') {
    showHelp();
    process.exit(0);
  }

  // Se comando requer conexão, verifica status
  if (['--backup', '-b', '--export', '--restore', '-r', '--import', '--status', '-s', '--test'].includes(command)) {
    // Forçar enabled se executado explicitamente via CLI
    if (!config.enabled) {
      console.log('Aviso: DB_ENABLED está como false, mas forçando conexão para este comando CLI...');
      process.env.DB_ENABLED = 'true';
    }

    console.log('Conectando ao MySQL 5.7...');
    const initRes = await db.initDb();
    if (!initRes.connected) {
      console.error('\n[ERRO DE CONEXÃO]');
      console.error(initRes.message);
      console.error('\nVerifique se o serviço do MySQL está iniciado e revise o arquivo .env ou data/db-config.json.');
      process.exit(1);
    }
  }

  try {
    switch (command) {
      case '--test':
      case '-t': {
        console.log('Testando conexão com o MySQL...');
        const testRes = await db.testConnection();
        if (testRes.ok) {
          console.log(`✓ Conexão bem-sucedida!`);
          console.log(`  Versão do MySQL: ${testRes.version}`);
          console.log(`  Banco de Dados: ${testRes.database}`);
        } else {
          console.error(`✗ Erro na conexão: ${testRes.error}`);
        }
        break;
      }

      case '--status':
      case '-s': {
        console.log('Obtendo status consolidado do banco de dados e arquivos...\n');
        const st = await db.getStatus();
        console.log(`Status de Conexão: ${st.connected ? '🟢 CONECTADO' : '🔴 DESCONECTADO'}`);
        console.log(`Servidor: ${st.host}:${st.port} (Banco: ${st.database})`);
        console.log(`\nRegistros no Banco de Dados MySQL:`);
        console.log(`  • Propostas Salvas e Revisões: ${st.counts.proposals}`);
        console.log(`  • Usuários Cadastrados: ${st.counts.users}`);
        console.log(`  • Rascunhos Ativos: ${st.counts.activeProposals}`);
        console.log(`  • Modelos / Templates: ${st.counts.modelTemplates}`);
        console.log(`  • Catálogo de Barcos: ${st.counts.modelsCatalog}`);

        // Comparar com arquivos em disco
        const dataDir = path.join(__dirname, 'data');
        const proposalsDir = path.join(dataDir, 'proposals');
        const fileProposalsCount = fs.existsSync(proposalsDir) ? fs.readdirSync(proposalsDir).filter(f => f.endsWith('.json')).length : 0;
        console.log(`\nArquivos JSON em Disco (data/):`);
        console.log(`  • Arquivos de Propostas: ${fileProposalsCount}`);
        break;
      }

      case '--backup':
      case '-b':
      case '--export': {
        console.log('Iniciando BACKUP COMPLETO de todos os arquivos JSON locais para o MySQL 5.7...');
        const startTime = Date.now();
        const res = await db.exportAllFilesToDb();
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log('\n✓ BACKUP CONCLUÍDO COM SUCESSO!');
        console.log(`Tempo decorrido: ${duration}s`);
        console.log(`Registros sincronizados para o MySQL:`);
        console.log(`  • Usuários: ${res.counts.users}`);
        console.log(`  • Propostas e Revisões: ${res.counts.proposals}`);
        console.log(`  • Rascunhos Ativos: ${res.counts.activeProposals}`);
        console.log(`  • Templates de Modelos: ${res.counts.modelTemplates}`);
        console.log(`  • Catálogo de Modelos: ${res.counts.modelsCatalog}`);
        console.log(`  • Configurações: ${res.counts.settings}`);
        break;
      }

      case '--restore':
      case '-r':
      case '--import': {
        console.log('⚠️  ATENÇÃO: Este comando irá LER todos os dados do MySQL 5.7 e RECRIAR/RESTAURAR os arquivos JSON em disco (pasta data/).');
        console.log('Iniciando restauração de emergência a partir do MySQL...');
        const startTime = Date.now();
        const res = await db.restoreAllFilesFromDb();
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log('\n✓ RESTAURAÇÃO CONCLUÍDA COM SUCESSO!');
        console.log(`Tempo decorrido: ${duration}s`);
        console.log(`Arquivos JSON regerados em data/:`);
        console.log(`  • Usuários restaurados: ${res.restored.users}`);
        console.log(`  • Propostas salvas restauradas: ${res.restored.proposals}`);
        console.log(`  • Rascunhos ativos restaurados: ${res.restored.activeProposals}`);
        console.log(`  • Templates de fábrica restaurados: ${res.restored.modelTemplates}`);
        console.log(`  • Catálogo de barcos restaurado: ${res.restored.modelsCatalog}`);
        break;
      }

      default:
        console.error(`Comando desconhecido: "${command}". Use --help para ver as opções.`);
        process.exit(1);
    }
  } catch (err) {
    console.error('\n[ERRO DE EXECUÇÃO]');
    console.error(err);
    process.exit(1);
  } finally {
    process.exit(0);
  }
}

function showHelp() {
  console.log(`
Comandos Disponíveis:

  node sync-db.js --backup
    Lê todos os arquivos da pasta 'data/' (usuários, propostas salvas,
    revisões, rascunhos ativos, configurações e templates) e faz o
    backup/espelhamento completo dentro do banco de dados MySQL 5.7.

  node sync-db.js --restore
    RECUPERAÇÃO DE DESASTRES: Lê todos os registros do MySQL 5.7 e
    recria todos os arquivos JSON e pastas em 'data/'. Use caso algum
    arquivo seja apagado acidentalmente no servidor ou em nova instalação.

  node sync-db.js --status
    Mostra o status da conexão com o MySQL e compara a quantidade de
    registros salvos no banco versus os arquivos em disco.

  node sync-db.js --test
    Testa se os dados de host, porta, usuário e senha do MySQL no .env
    estão corretos e conseguem autenticar.

Atalhos npm:
  npm run db:backup
  npm run db:restore
  npm run db:status
`);
}

main();
