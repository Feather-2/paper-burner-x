-- Migration: Add chat messages, references, and prompt pool tables
-- Created: 2025-10-19

-- Add new columns to user_settings
ALTER TABLE user_settings
  ADD COLUMN IF NOT EXISTS ocr_config JSONB,
  ADD COLUMN IF NOT EXISTS academic_search_config JSONB,
  ADD COLUMN IF NOT EXISTS ui_layout_config JSONB;

-- Create chat_messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_document_timestamp
  ON chat_messages(document_id, timestamp);

-- Create references table
CREATE TABLE IF NOT EXISTS references (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  citation_key TEXT NOT NULL,
  doi TEXT,
  title TEXT,
  authors JSONB,
  year INTEGER,
  journal TEXT,
  volume TEXT,
  pages TEXT,
  url TEXT,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(document_id, citation_key)
);

CREATE INDEX IF NOT EXISTS idx_references_document
  ON references(document_id);

-- Create prompt_pool table
CREATE TABLE IF NOT EXISTS prompt_pool (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompts JSONB NOT NULL,
  health_config JSONB,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Add comments
COMMENT ON TABLE chat_messages IS '聊天消息历史记录';
COMMENT ON TABLE references IS '文献引用数据';
COMMENT ON TABLE prompt_pool IS '用户提示词池';
