CREATE TABLE moments (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  images TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX moments_timeline ON moments(created_at DESC, id DESC);

-- Track uploads separately so abandoned images can be removed after seven days.
CREATE TABLE uploads (
  key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  expired INTEGER NOT NULL DEFAULT 0,
  moment_id TEXT REFERENCES moments(id)
);
CREATE INDEX uploads_unclaimed ON uploads(created_at) WHERE moment_id IS NULL;

CREATE TABLE login_attempts (
  ip TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);

CREATE TRIGGER uploads_claim_once
BEFORE UPDATE OF moment_id ON uploads
WHEN OLD.moment_id IS NOT NULL AND NEW.moment_id IS NOT NULL AND OLD.moment_id != NEW.moment_id
BEGIN
  SELECT RAISE(ABORT, 'Image already belongs to a moment');
END;

CREATE TRIGGER uploads_reject_expired
BEFORE UPDATE OF moment_id ON uploads
WHEN OLD.expired = 1 AND NEW.moment_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'Image expired');
END;

-- Validate references in the same transaction that creates the moment.
CREATE TRIGGER moments_require_uploads
BEFORE INSERT ON moments
WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.images) AS image
  LEFT JOIN uploads ON uploads.key = json_extract(image.value, '$.key')
  WHERE uploads.key IS NULL OR uploads.expired = 1 OR uploads.moment_id IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'Image unavailable');
END;
