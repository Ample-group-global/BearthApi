-- patch_v32_activity_log.sql
-- NFT activity log table + DB-level triggers.
-- Every delivery_status change on nft_records is captured automatically.
-- Wave lifecycle events (reveal, treasury-close, schedule) are logged by trigger.

-- ── Logger table ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS nft_activity_log (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type  text        NOT NULL,  -- 'nft_record' | 'nft_wave'
  entity_id    uuid        NOT NULL,
  action       text        NOT NULL,  -- human-readable action name
  old_status   text,                  -- delivery_status_code before change
  new_status   text,                  -- delivery_status_code after change
  meta         jsonb,                 -- tx_hash, wave_number, token_id, etc.
  created_at   timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_nft_activity_log_entity   ON nft_activity_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_nft_activity_log_action   ON nft_activity_log (action);
CREATE INDEX IF NOT EXISTS idx_nft_activity_log_created  ON nft_activity_log (created_at DESC);

-- ── Trigger: log every delivery_status change on nft_records ─────────────────

CREATE OR REPLACE FUNCTION fn_nft_record_status_audit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_old_code text;
  v_new_code text;
BEGIN
  IF NEW.delivery_status_id IS NOT DISTINCT FROM OLD.delivery_status_id THEN
    RETURN NEW;
  END IF;

  SELECT code INTO v_old_code FROM lookup_values WHERE id = OLD.delivery_status_id;
  SELECT code INTO v_new_code FROM lookup_values WHERE id = NEW.delivery_status_id;

  INSERT INTO nft_activity_log (entity_type, entity_id, action, old_status, new_status, meta)
  VALUES (
    'nft_record',
    NEW.id,
    'delivery_status_changed',
    v_old_code,
    v_new_code,
    jsonb_strip_nulls(jsonb_build_object(
      'serial_number', NEW.serial_number,
      'token_id',      NEW.token_id,
      'mint_type',     NEW.mint_type,
      'is_revealed',   NEW.is_revealed
    ))
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nft_record_status_audit ON nft_records;
CREATE TRIGGER trg_nft_record_status_audit
  AFTER UPDATE OF delivery_status_id ON nft_records
  FOR EACH ROW EXECUTE FUNCTION fn_nft_record_status_audit();

-- ── Trigger: log wave lifecycle events ───────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_nft_wave_audit()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Wave revealed
  IF NEW.is_revealed = TRUE AND (OLD.is_revealed IS DISTINCT FROM TRUE) THEN
    INSERT INTO nft_activity_log (entity_type, entity_id, action, meta)
    VALUES (
      'nft_wave', NEW.id, 'wave_revealed',
      jsonb_strip_nulls(jsonb_build_object(
        'wave_number',    NEW.wave_number,
        'reveal_uri',     NEW.wave_reveal_uri,
        'starting_index', NEW.starting_index,
        'tx_hash',        NEW.last_tx_hash
      ))
    );
  END IF;

  -- Wave closed
  IF NEW.wave_closed = TRUE AND (OLD.wave_closed IS DISTINCT FROM TRUE) THEN
    INSERT INTO nft_activity_log (entity_type, entity_id, action, meta)
    VALUES (
      'nft_wave', NEW.id, 'wave_closed',
      jsonb_build_object('wave_number', NEW.wave_number, 'sold_count', NEW.sold_count)
    );
  END IF;

  -- Treasury closed
  IF NEW.close_action IS NOT NULL AND (OLD.close_action IS DISTINCT FROM NEW.close_action) THEN
    INSERT INTO nft_activity_log (entity_type, entity_id, action, meta)
    VALUES (
      'nft_wave', NEW.id, 'treasury_close',
      jsonb_strip_nulls(jsonb_build_object(
        'wave_number',           NEW.wave_number,
        'close_action',          NEW.close_action,
        'treasury_recipient',    NEW.treasury_recipient,
        'treasury_minted_count', NEW.treasury_minted_count
      ))
    );
  END IF;

  -- Schedule updated
  IF NEW.scheduled_start IS DISTINCT FROM OLD.scheduled_start
  OR NEW.scheduled_end   IS DISTINCT FROM OLD.scheduled_end THEN
    INSERT INTO nft_activity_log (entity_type, entity_id, action, meta)
    VALUES (
      'nft_wave', NEW.id, 'schedule_updated',
      jsonb_build_object(
        'wave_number',     NEW.wave_number,
        'scheduled_start', NEW.scheduled_start,
        'scheduled_end',   NEW.scheduled_end
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_nft_wave_audit ON nft_waves;
CREATE TRIGGER trg_nft_wave_audit
  AFTER UPDATE ON nft_waves
  FOR EACH ROW EXECUTE FUNCTION fn_nft_wave_audit();
