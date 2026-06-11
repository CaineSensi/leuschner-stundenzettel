-- Fotos aus WhatsApp-Chats zur Anfrage hinterlegen
-- Jeder Eintrag: { path, mime, name, width?, height?, size? }
ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS photos jsonb DEFAULT '[]'::jsonb NOT NULL;
