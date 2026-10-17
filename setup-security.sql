-- ============================================================================
-- SEDNA GROUP - SCRIPT DE BLINDAGEM E MENOR PRIVILÉGIO PARA MYSQL 5.7
-- Arquivo: setup-security.sql
-- ============================================================================
-- RECOMENDAÇÃO DE INFRAESTRUTURA (my.cnf / my.ini do MySQL 5.7):
--   [mysqld]
--   bind-address = 127.0.0.1
--   port = 3306
--   local-infile = 0
--   symbolic-links = 0
--
-- IMPORTANTE: Substitua 'TROQUE_POR_SENHA_FORTE_APP_2026!' e
-- 'TROQUE_POR_SENHA_FORTE_LEITURA_2026!' pelas senhas reais antes de executar
-- e atualize o arquivo `.env` da aplicação.
-- ============================================================================

-- 1. Criação do Banco de Dados Principal (Comercial + Tabelas de Ajustes do RH)
CREATE DATABASE IF NOT EXISTS `sedna_pedidos`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `sedna_pedidos`;

-- 2. Criação prévia das tabelas para que o usuário da aplicação NÃO precise
--    de permissões DDL administrativas (CREATE, ALTER, DROP) em produção.

CREATE TABLE IF NOT EXISTS `users` (
  `id` VARCHAR(64) NOT NULL,
  `username` VARCHAR(64) NOT NULL,
  `password` VARCHAR(255) NOT NULL,
  `name` VARCHAR(128) NOT NULL,
  `role` VARCHAR(32) NOT NULL DEFAULT 'commercial',
  `role_label` VARCHAR(64) DEFAULT 'Comercial',
  `can_view_all` TINYINT(1) NOT NULL DEFAULT 0,
  `can_edit_all` TINYINT(1) NOT NULL DEFAULT 0,
  `can_manage_users` TINYINT(1) NOT NULL DEFAULT 0,
  `phone` VARCHAR(64) DEFAULT NULL,
  `email` VARCHAR(128) DEFAULT NULL,
  `data_json` LONGTEXT NOT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_users_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `proposals` (
  `id` VARCHAR(128) NOT NULL,
  `file_name` VARCHAR(255) DEFAULT NULL,
  `name` VARCHAR(255) NOT NULL,
  `model_name` VARCHAR(64) DEFAULT NULL,
  `client_name` VARCHAR(128) DEFAULT NULL,
  `proposal_number` VARCHAR(64) DEFAULT NULL,
  `revision` INT NOT NULL DEFAULT 1,
  `full_code` VARCHAR(64) DEFAULT NULL,
  `author_username` VARCHAR(64) DEFAULT NULL,
  `author_name` VARCHAR(128) DEFAULT NULL,
  `price` VARCHAR(64) DEFAULT NULL,
  `data_json` LONGTEXT NOT NULL,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_proposals_model` (`model_name`),
  KEY `idx_proposals_client` (`client_name`),
  KEY `idx_proposals_number` (`proposal_number`),
  KEY `idx_proposals_author` (`author_username`),
  KEY `idx_proposals_updated` (`updated_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `active_proposals` (
  `id` VARCHAR(128) NOT NULL,
  `username` VARCHAR(64) NOT NULL,
  `model_name` VARCHAR(64) DEFAULT NULL,
  `file_name` VARCHAR(255) DEFAULT NULL,
  `data_json` LONGTEXT NOT NULL,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_active_user` (`username`),
  KEY `idx_active_model` (`model_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `model_templates` (
  `model_name` VARCHAR(64) NOT NULL,
  `file_name` VARCHAR(255) DEFAULT NULL,
  `data_json` LONGTEXT NOT NULL,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`model_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `models_catalog` (
  `name` VARCHAR(64) NOT NULL,
  `image` VARCHAR(512) DEFAULT NULL,
  `data_json` LONGTEXT NOT NULL,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `system_settings` (
  `setting_key` VARCHAR(64) NOT NULL,
  `setting_value` LONGTEXT NOT NULL,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sessions` (
  `token` VARCHAR(128) NOT NULL,
  `user_id` VARCHAR(64) DEFAULT NULL,
  `username` VARCHAR(64) DEFAULT NULL,
  `user_data` LONGTEXT DEFAULT NULL,
  `expires_at` DATETIME DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`token`),
  KEY `idx_sessions_username` (`username`),
  KEY `idx_sessions_expires` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `backup_logs` (
  `id` INT AUTO_INCREMENT NOT NULL,
  `action` VARCHAR(64) NOT NULL,
  `entity_type` VARCHAR(64) NOT NULL,
  `entity_id` VARCHAR(128) DEFAULT NULL,
  `status` VARCHAR(32) NOT NULL DEFAULT 'SUCCESS',
  `message` TEXT DEFAULT NULL,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_logs_action` (`action`),
  KEY `idx_logs_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `rh_ponto_lancamentos` (
  `id` VARCHAR(64) NOT NULL,
  `action_type` VARCHAR(32) NOT NULL DEFAULT 'ADD',
  `original_log_id` VARCHAR(128) DEFAULT NULL,
  `employee_id` VARCHAR(64) NOT NULL,
  `employee_name` VARCHAR(150) NOT NULL,
  `registration` VARCHAR(64) DEFAULT NULL,
  `department` VARCHAR(100) DEFAULT NULL,
  `log_date` VARCHAR(10) NOT NULL,
  `log_time` VARCHAR(8) NOT NULL,
  `direction` VARCHAR(16) NOT NULL DEFAULT 'ENTRADA',
  `reason_type` VARCHAR(64) DEFAULT 'Ajuste Manual RH',
  `notes` TEXT DEFAULT NULL,
  `updated_by` VARCHAR(100) DEFAULT NULL,
  `data_json` LONGTEXT DEFAULT NULL,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rh_lanc_emp_date` (`employee_name`, `log_date`),
  KEY `idx_rh_lanc_orig` (`original_log_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `rh_jornada_diaria_ajustes` (
  `id` VARCHAR(160) NOT NULL,
  `employee_id` VARCHAR(64) NOT NULL,
  `employee_name` VARCHAR(150) NOT NULL,
  `registration` VARCHAR(64) DEFAULT NULL,
  `department` VARCHAR(100) DEFAULT NULL,
  `work_date` VARCHAR(10) NOT NULL,
  `adjustment_mode` VARCHAR(32) NOT NULL DEFAULT 'PUNCHES',
  `manual_worked_minutes` INT DEFAULT 0,
  `bonus_minutes` INT DEFAULT 0,
  `custom_expected_minutes` INT DEFAULT NULL,
  `reason_type` VARCHAR(64) DEFAULT 'Serviço Externo / Viagem',
  `notes` TEXT DEFAULT NULL,
  `updated_by` VARCHAR(100) DEFAULT NULL,
  `data_json` LONGTEXT DEFAULT NULL,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rh_adj_date` (`work_date`),
  KEY `idx_rh_adj_emp` (`employee_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 3. USUÁRIO DEDICADO DA APLICAÇÃO (`sedna_app`) - PRINCÍPIO DO MENOR PRIVILÉGIO
--    Restrito a loopback (127.0.0.1 / localhost)
--    Permissões: APENAS DML (SELECT, INSERT, UPDATE, DELETE)
--    Sem permissões administrativas: SEM DROP, ALTER, CREATE, GRANT, FILE, SUPER
-- ============================================================================
CREATE USER IF NOT EXISTS 'sedna_app'@'127.0.0.1' IDENTIFIED BY 'TROQUE_POR_SENHA_FORTE_APP_2026!';
CREATE USER IF NOT EXISTS 'sedna_app'@'localhost' IDENTIFIED BY 'TROQUE_POR_SENHA_FORTE_APP_2026!';

REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'sedna_app'@'127.0.0.1';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'sedna_app'@'localhost';

GRANT SELECT, INSERT, UPDATE, DELETE ON `sedna_pedidos`.* TO 'sedna_app'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE ON `sedna_pedidos`.* TO 'sedna_app'@'localhost';

-- ============================================================================
-- 4. USUÁRIO DEDICADO DE LEITURA DA CATRACA iD CONTROL (`rh_leitura`)
--    Permissões: APENAS SELECT e SHOW VIEW no banco `acesso`
--    Impossibilita matematicamente qualquer INSERT, UPDATE, DELETE ou DROP no iD Control
-- ============================================================================
CREATE USER IF NOT EXISTS 'rh_leitura'@'127.0.0.1' IDENTIFIED BY 'TROQUE_POR_SENHA_FORTE_LEITURA_2026!';
CREATE USER IF NOT EXISTS 'rh_leitura'@'localhost' IDENTIFIED BY 'TROQUE_POR_SENHA_FORTE_LEITURA_2026!';

REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'rh_leitura'@'127.0.0.1';
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'rh_leitura'@'localhost';

GRANT SELECT, SHOW VIEW ON `acesso`.* TO 'rh_leitura'@'127.0.0.1';
GRANT SELECT, SHOW VIEW ON `acesso`.* TO 'rh_leitura'@'localhost';

-- Aplicar privilégios imediatamente
FLUSH PRIVILEGES;
