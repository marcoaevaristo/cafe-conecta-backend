-- Migration: adiciona suporte a recuperação de senha
-- Execute no Supabase SQL Editor (https://app.supabase.com → SQL Editor)

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS reset_token TEXT,
  ADD COLUMN IF NOT EXISTS reset_token_expira TIMESTAMPTZ;

-- Índice para busca rápida por token (opcional, mas recomendado)
CREATE INDEX IF NOT EXISTS idx_usuarios_reset_token ON usuarios(reset_token) WHERE reset_token IS NOT NULL;
