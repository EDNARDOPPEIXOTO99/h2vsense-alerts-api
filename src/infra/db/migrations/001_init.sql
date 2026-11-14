-- Leituras brutas dos sensores (série temporal simples).
CREATE TABLE IF NOT EXISTS readings (
  id           UUID PRIMARY KEY,
  sensor_id    TEXT        NOT NULL,
  ppm          NUMERIC(10, 2) NOT NULL CHECK (ppm >= 0),
  severity     TEXT        NOT NULL CHECK (severity IN ('normal', 'attention', 'alarm')),
  measured_at  TIMESTAMPTZ NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Consulta típica: histórico de um sensor em ordem temporal.
CREATE INDEX IF NOT EXISTS idx_readings_sensor_time ON readings (sensor_id, measured_at DESC);

CREATE TABLE IF NOT EXISTS alerts (
  id               UUID PRIMARY KEY,
  sensor_id        TEXT        NOT NULL,
  severity         TEXT        NOT NULL CHECK (severity IN ('attention', 'alarm')),
  status           TEXT        NOT NULL CHECK (status IN ('open', 'acknowledged')),
  peak_ppm         NUMERIC(10, 2) NOT NULL,
  readings_count   INTEGER     NOT NULL DEFAULT 1,
  opened_at        TIMESTAMPTZ NOT NULL,
  last_reading_at  TIMESTAMPTZ NOT NULL,
  acknowledged_at  TIMESTAMPTZ,
  acknowledged_by  TEXT
);

-- Regra de negócio garantida também no banco: no máximo 1 alerta aberto por sensor.
CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_one_open_per_sensor
  ON alerts (sensor_id) WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_alerts_status_opened ON alerts (status, opened_at DESC);
