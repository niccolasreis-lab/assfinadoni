-- Candidate only: promote to a CLI-generated migration after isolated validation.
-- No historical backfill and no changes to existing financial tables or RPCs.
CREATE TABLE IF NOT EXISTS public.finance_wallet_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finance_user_id uuid NOT NULL REFERENCES public.finance_users(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.dashboard_accounts(id) ON DELETE SET NULL,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 60),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (finance_user_id, id),
  UNIQUE (finance_user_id, account_id)
);

CREATE TABLE IF NOT EXISTS public.finance_transaction_attributions (
  transaction_id uuid PRIMARY KEY REFERENCES public.finance_transactions(id) ON DELETE CASCADE,
  finance_user_id uuid NOT NULL REFERENCES public.finance_users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('unknown', 'participant', 'joint')),
  participant_ids uuid[] NOT NULL DEFAULT '{}',
  -- Retained for future verified ingestion; this historical-assignment RPC never sets it.
  recorded_by_participant_id uuid,
  attributed_by_account_id uuid NOT NULL REFERENCES public.dashboard_accounts(id),
  request_id text NOT NULL CHECK (length(btrim(request_id)) BETWEEN 1 AND 180),
  revision integer NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (finance_user_id, recorded_by_participant_id)
    REFERENCES public.finance_wallet_participants(finance_user_id, id),
  CHECK (coalesce(array_ndims(participant_ids), 1) = 1),
  CHECK (
    (kind = 'unknown' AND cardinality(participant_ids) = 0)
    OR (kind = 'participant' AND cardinality(participant_ids) = 1)
    OR (kind = 'joint' AND cardinality(participant_ids) BETWEEN 2 AND 20)
  )
);

ALTER TABLE public.finance_wallet_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finance_transaction_attributions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.finance_wallet_participants, public.finance_transaction_attributions
  FROM PUBLIC, anon, authenticated, service_role;
-- Registry provisioning is administrative, not an input controlled by the caller.
GRANT SELECT ON public.finance_wallet_participants TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.finance_transaction_attributions TO service_role;

CREATE OR REPLACE FUNCTION public.finance_validate_transaction_attribution()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  wallet uuid;
  tx_type text;
  removed timestamptz;
  participant_count integer;
BEGIN
  SELECT user_id, transaction_type, deleted_at INTO wallet, tx_type, removed
    FROM finance_transactions WHERE id = NEW.transaction_id;
  IF NOT FOUND OR wallet IS DISTINCT FROM NEW.finance_user_id
    OR tx_type <> 'despesa' OR removed IS NOT NULL THEN
    RAISE EXCEPTION 'Lançamento indisponível para atribuição' USING ERRCODE = '23514';
  END IF;
  IF array_position(NEW.participant_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Participante nulo' USING ERRCODE = '23514';
  END IF;
  SELECT count(DISTINCT value) INTO participant_count FROM unnest(NEW.participant_ids) AS value;
  IF participant_count <> cardinality(NEW.participant_ids) THEN
    RAISE EXCEPTION 'Participante repetido' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(NEW.participant_ids) AS ids(value)
    LEFT JOIN finance_wallet_participants p ON p.id = ids.value
      AND p.finance_user_id = NEW.finance_user_id AND p.active
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Participante indisponível nesta carteira' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.finance_validate_transaction_attribution()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS finance_transaction_attribution_guard ON public.finance_transaction_attributions;
CREATE TRIGGER finance_transaction_attribution_guard
  BEFORE INSERT OR UPDATE ON public.finance_transaction_attributions
  FOR EACH ROW EXECUTE FUNCTION public.finance_validate_transaction_attribution();

CREATE OR REPLACE FUNCTION public.finance_set_transaction_attribution(
  p_account_id uuid, p_transaction_id uuid, p_kind text, p_participant_ids uuid[],
  p_recorded_by_participant_id uuid, p_confirmed boolean, p_request_id text,
  p_expected_revision integer DEFAULT 0
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  wallet uuid;
  old_row finance_transaction_attributions;
  result finance_transaction_attributions;
  ids uuid[];
BEGIN
  -- p_account_id must come from the authenticated session/trusted connector.
  IF NOT EXISTS (SELECT 1 FROM dashboard_accounts WHERE id = p_account_id AND active) THEN
    RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE = '42501';
  END IF;
  -- A short row lock serializes attribution operations for the same transaction.
  -- No transaction field is updated; concurrency behavior still needs a full DB test.
  SELECT user_id INTO wallet FROM finance_transactions
    WHERE id = p_transaction_id AND deleted_at IS NULL AND transaction_type = 'despesa'
    FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM finance_dashboard_couple_memberships
    WHERE account_id = p_account_id AND finance_user_id = wallet
  ) THEN
    RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Confirmação explícita necessária' USING ERRCODE = '22023';
  END IF;
  IF p_recorded_by_participant_id IS NOT NULL THEN
    RAISE EXCEPTION 'Autor da origem exige ingestão verificada' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('unknown', 'participant', 'joint')
    OR p_request_id IS NULL OR length(btrim(p_request_id)) NOT BETWEEN 1 AND 180
    OR p_expected_revision IS NULL OR p_expected_revision < 0 OR p_participant_ids IS NULL THEN
    RAISE EXCEPTION 'Atribuição inválida' USING ERRCODE = '22023';
  END IF;
  IF array_ndims(p_participant_ids) > 1 THEN
    RAISE EXCEPTION 'Participantes inválidos' USING ERRCODE = '22023';
  END IF;
  IF array_position(p_participant_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Participantes inválidos' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(array_agg(value ORDER BY value), '{}'::uuid[]) INTO ids
    FROM unnest(p_participant_ids) AS value;
  SELECT * INTO old_row FROM finance_transaction_attributions WHERE transaction_id = p_transaction_id;
  IF old_row.transaction_id IS NOT NULL AND old_row.finance_user_id IS DISTINCT FROM wallet THEN
    RAISE EXCEPTION 'Carteira da atribuição não corresponde ao lançamento' USING ERRCODE = '23514';
  END IF;
  IF old_row.transaction_id IS NOT NULL AND old_row.request_id = p_request_id THEN
    IF old_row.kind IS NOT DISTINCT FROM p_kind AND old_row.participant_ids = ids
      AND old_row.attributed_by_account_id = p_account_id THEN
      RETURN to_jsonb(old_row);
    END IF;
    RAISE EXCEPTION 'Chave de confirmação reutilizada com dados diferentes' USING ERRCODE = '23505';
  END IF;
  IF p_expected_revision <> coalesce(old_row.revision, 0) THEN
    RAISE EXCEPTION 'Atribuição alterada; consulte novamente' USING ERRCODE = '40001';
  END IF;
  INSERT INTO finance_transaction_attributions (
    transaction_id, finance_user_id, kind, participant_ids, recorded_by_participant_id,
    attributed_by_account_id, request_id, revision
  ) VALUES (
    p_transaction_id, wallet, p_kind, ids, NULL, p_account_id,
    p_request_id, coalesce(old_row.revision, 0) + 1
  ) ON CONFLICT (transaction_id) DO UPDATE SET
    kind = EXCLUDED.kind, participant_ids = EXCLUDED.participant_ids,
    attributed_by_account_id = EXCLUDED.attributed_by_account_id,
    request_id = EXCLUDED.request_id, revision = EXCLUDED.revision, updated_at = now()
  RETURNING * INTO result;
  PERFORM finance_audit_write (
    wallet, 'WEB', 'UPDATE', 'transaction_attribution', p_transaction_id,
    p_account_id, p_request_id,
    CASE WHEN old_row.transaction_id IS NULL THEN NULL ELSE to_jsonb(old_row) END,
    to_jsonb(result), '{}'::jsonb
  );
  RETURN to_jsonb(result);
END $$;
REVOKE ALL ON FUNCTION public.finance_set_transaction_attribution(uuid, uuid, text, uuid[], uuid, boolean, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_set_transaction_attribution(uuid, uuid, text, uuid[], uuid, boolean, text, integer)
  TO service_role;
