-- ========================================================
-- SISTEMA GERADOR DE PEDIDOS SEDNA
-- SCHEMA MYSQL 5.7 - BANCO DE DADOS DE BACKUP & RECUPERAÇÃO
-- ========================================================
-- Este script é 100% compatível com MySQL 5.7, 8.0 e MariaDB.
-- O sistema opera primariamente via arquivos JSON locais (alta
-- velocidade e independência de infraestrutura), utilizando o
-- MySQL 5.7 como réplica e backup assíncrono para recuperação.
-- ========================================================

CREATE DATABASE IF NOT EXISTS `sedna_pedidos`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `sedna_pedidos`;

-- 1. TABELA DE USUÁRIOS
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

-- 2. TABELA DE PROPOSTAS E HISTÓRICO DE REVISÕES
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

-- 3. TABELA DE RASCUNHOS ATIVOS POR USUÁRIO E MODELO
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

-- 4. TABELA DE TEMPLATES DE FÁBRICA DOS MODELOS
CREATE TABLE IF NOT EXISTS `model_templates` (
  `model_name` VARCHAR(64) NOT NULL,
  `file_name` VARCHAR(255) DEFAULT NULL,
  `data_json` LONGTEXT NOT NULL,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`model_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. TABELA DO CATÁLOGO DE MODELOS
CREATE TABLE IF NOT EXISTS `models_catalog` (
  `name` VARCHAR(64) NOT NULL,
  `image` VARCHAR(512) DEFAULT NULL,
  `data_json` LONGTEXT NOT NULL,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. TABELA DE CONFIGURAÇÕES GERAIS DO SISTEMA
CREATE TABLE IF NOT EXISTS `system_settings` (
  `setting_key` VARCHAR(64) NOT NULL,
  `setting_value` LONGTEXT NOT NULL,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. TABELA DE SESSÕES ATIVAS
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

-- 8. TABELA DE LOGS E AUDITORIA DE BACKUP
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
