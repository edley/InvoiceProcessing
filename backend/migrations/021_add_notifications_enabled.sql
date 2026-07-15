ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN DEFAULT true;
