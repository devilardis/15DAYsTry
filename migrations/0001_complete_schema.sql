-- 创建 tokens 表
CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  is_active BOOLEAN DEFAULT TRUE
);

-- 创建 devices 表
CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id INTEGER NOT NULL,
  user_agent TEXT NOT NULL,
  os TEXT,
  app_name TEXT,
  app_version TEXT,
  device_id TEXT,
  device_name TEXT,
  first_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (token_id) REFERENCES tokens (id) ON DELETE CASCADE
);

-- 添加设备特征字段
ALTER TABLE devices ADD COLUMN language TEXT;
ALTER TABLE devices ADD COLUMN screen_width INTEGER;
ALTER TABLE devices ADD COLUMN screen_height INTEGER;
ALTER TABLE devices ADD COLUMN color_depth INTEGER;
ALTER TABLE devices ADD COLUMN device_fingerprint TEXT;
ALTER TABLE devices ADD COLUMN http_accept_language TEXT;

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_tokens_token ON tokens (token);
CREATE INDEX IF NOT EXISTS idx_devices_token_id ON devices (token_id);
CREATE INDEX IF NOT EXISTS idx_devices_device_id ON devices (device_id);
CREATE INDEX IF NOT EXISTS idx_devices_os ON devices (os);
CREATE INDEX IF NOT EXISTS idx_devices_fingerprint ON devices (device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_devices_type ON devices (os);
