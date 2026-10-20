-- Candidate only. Apply after transaction-attribution.sql in an isolated test DB.
-- Administrative binding has no default or hardcoded participant phone numbers.
ALTER TABLE public.finance_wallet_participants ADD COLUMN IF NOT EXISTS whatsapp_jid text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.finance_wallet_participants'::regclass
      AND conname = 'finance_wallet_participants_whatsapp_jid_check') THEN
    ALTER TABLE public.finance_wallet_participants
      ADD CONSTRAINT finance_wallet_participants_whatsapp_jid_check
      CHECK (whatsapp_jid IS NULL OR whatsapp_jid ~ '^[0-9]{8,15}@s[.]whatsapp[.]net$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.finance_wallet_participants'::regclass
      AND conname = 'finance_wallet_participants_wallet_whatsapp_jid_key') THEN
    ALTER TABLE public.finance_wallet_participants
      ADD CONSTRAINT finance_wallet_participants_wallet_whatsapp_jid_key
      UNIQUE (finance_user_id, whatsapp_jid);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.finance_whatsapp_payer_context(
  p_user_id uuid, p_sender_jid text, p_transaction_ids uuid[] DEFAULT '{}'
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  actor_account uuid;
  actor_participant uuid;
  people jsonb;
  attributes jsonb;
BEGIN
  -- The existing bot's shared-wallet guard; not a claim supplied by the client.
  IF NOT EXISTS (SELECT 1 FROM finance_users WHERE id = p_user_id AND telegram_chat_id = 120363433)
    OR p_sender_jid IS NULL OR p_sender_jid !~ '^[0-9]{8,15}@s[.]whatsapp[.]net$' THEN
    RETURN jsonb_build_object('available', false);
  END IF;
  SELECT p.account_id, p.id INTO actor_account, actor_participant
    FROM finance_wallet_participants p
    JOIN dashboard_accounts a ON a.id = p.account_id AND a.active
    JOIN finance_dashboard_couple_memberships m ON m.account_id = a.id AND m.finance_user_id = p.finance_user_id
    WHERE p.finance_user_id = p_user_id AND p.whatsapp_jid = p_sender_jid AND p.active;
  IF NOT FOUND THEN RETURN jsonb_build_object('available', false); END IF;
  IF p_transaction_ids IS NULL OR coalesce(array_ndims(p_transaction_ids), 1) <> 1
    OR cardinality(p_transaction_ids) > 50 OR array_position(p_transaction_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Consulta de atribuições inválida' USING ERRCODE = '22023';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'display_name', p.display_name, 'active', p.active) ORDER BY p.id), '[]'::jsonb)
    INTO people FROM finance_wallet_participants p WHERE p.finance_user_id = p_user_id;
  -- Join both transaction ID and the ledger's wallet, never metadata wallet alone.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'transaction_id', a.transaction_id, 'finance_user_id', a.finance_user_id,
    'kind', a.kind, 'participant_ids', a.participant_ids,
    'recorded_by_participant_id', a.recorded_by_participant_id, 'revision', a.revision
  ) ORDER BY a.transaction_id), '[]'::jsonb) INTO attributes
    FROM finance_transaction_attributions a
    JOIN finance_transactions t ON t.id = a.transaction_id AND t.user_id = a.finance_user_id
    WHERE t.user_id = p_user_id AND t.id = ANY(p_transaction_ids)
      AND t.deleted_at IS NULL AND t.transaction_type = 'despesa';
  RETURN jsonb_build_object('available', true, 'actor_account_id', actor_account,
    'actor_participant_id', actor_participant, 'participants', people, 'attributions', attributes);
END $$;

CREATE OR REPLACE FUNCTION public.finance_whatsapp_set_payer(
  p_user_id uuid, p_sender_jid text, p_transaction_id uuid, p_source_event text,
  p_kind text, p_participant_ids uuid[], p_confirmed boolean
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  context jsonb;
  actor_account uuid;
  old_row finance_transaction_attributions;
  request_key text;
BEGIN
  context := finance_whatsapp_payer_context(p_user_id, p_sender_jid);
  IF context ->> 'available' IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Identidade do WhatsApp não autorizada' USING ERRCODE = '42501';
  END IF;
  actor_account := (context ->> 'actor_account_id')::uuid;
  IF p_confirmed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Confirmação explícita necessária' USING ERRCODE = '22023';
  END IF;
  IF p_source_event IS NULL OR length(p_source_event) NOT BETWEEN 1 AND 174
    OR btrim(p_source_event) <> p_source_event THEN
    RAISE EXCEPTION 'Evento de origem inválido' USING ERRCODE = '22023';
  END IF;
  -- Only a new ingestion event whose exact stable key was stored by the bot.
  -- This wrapper never creates a financial transaction or annotates unproven history.
  PERFORM 1 FROM finance_transactions
    WHERE id = p_transaction_id AND user_id = p_user_id AND deleted_at IS NULL
      AND transaction_type = 'despesa' AND source = 'API' AND external_event_id = p_source_event
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lançamento sem evento de origem correspondente' USING ERRCODE = '42501';
  END IF;
  request_key := p_source_event || ':payer';
  SELECT * INTO old_row FROM finance_transaction_attributions WHERE transaction_id = p_transaction_id;
  IF old_row.transaction_id IS NOT NULL AND (
    old_row.request_id IS DISTINCT FROM request_key OR old_row.attributed_by_account_id IS DISTINCT FROM actor_account
  ) THEN
    RAISE EXCEPTION 'Atribuição já confirmada por outro contexto' USING ERRCODE = '23505';
  END IF;
  RETURN jsonb_build_object('ok', true, 'attribution',
    finance_set_transaction_attribution(actor_account, p_transaction_id, p_kind,
      p_participant_ids, NULL, true, request_key, coalesce(old_row.revision, 0)));
END $$;

REVOKE ALL ON FUNCTION public.finance_whatsapp_payer_context(uuid, text, uuid[])
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finance_whatsapp_set_payer(uuid, text, uuid, text, text, uuid[], boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_whatsapp_payer_context(uuid, text, uuid[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.finance_whatsapp_set_payer(uuid, text, uuid, text, text, uuid[], boolean)
  TO service_role;
