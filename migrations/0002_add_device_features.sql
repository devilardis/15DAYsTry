-- 添加设备特征字段到devices表
ALTER TABLE devices ADD COLUMN language TEXT;
ALTER TABLE devices ADD COLUMN screen_width INTEGER;
ALTER TABLE devices ADD COLUMN screen_height INTEGER;
ALTER TABLE devices ADD COLUMN color_depth INTEGER;
ALTER TABLE devices ADD COLUMN device_fingerprint TEXT;
ALTER TABLE devices ADD COLUMN http_accept_language TEXT;

-- 创建设备指纹索引
CREATE INDEX IF NOT EXISTS idx_devices_fingerprint ON devices (device_fingerprint);
