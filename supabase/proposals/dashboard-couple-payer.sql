-- Read-only extension. The existing couple RPC and its monthly summary stay authoritative.
CREATE OR REPLACE FUNCTION public.finance_dashboard_couple_payer_transactions(
  p_account_id uuid, p_values jsonb DEFAULT '{}'
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  original jsonb;
  wallets uuid[];
  payer_kind text;
  payer_id_text text;
  selected_payer uuid;
  requested_view text;
  page_number integer;
  page_size integer := 50;
  month_start date;
  month_end date;
  date_from date;
  date_to date;
  search_text text;
  category_name text;
  selected_type text;
  rows_json jsonb;
  people jsonb;
BEGIN
  -- Reuse the current authorization, filter validation and exact monthly summary.
  original := finance_dashboard_couple_transactions(p_account_id, p_values);
  IF p_values IS NULL OR jsonb_typeof(p_values) <> 'object' THEN
    RAISE EXCEPTION 'Filtros de pagador inválidos' USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(m.finance_user_id) INTO wallets
    FROM finance_dashboard_couple_memberships m
    JOIN dashboard_accounts a ON a.id = m.account_id AND a.active
    WHERE m.account_id = p_account_id;
  IF wallets IS NULL THEN
    RAISE EXCEPTION 'Acesso à carteira do casal não autorizado' USING ERRCODE = '42501';
  END IF;
  payer_kind := coalesce(p_values ->> 'payer_kind', 'all');
  payer_id_text := nullif(p_values ->> 'payer_id', '');
  IF payer_kind NOT IN ('all', 'unknown', 'participant', 'joint')
    OR (payer_id_text IS NOT NULL AND payer_kind <> 'participant') THEN
    RAISE EXCEPTION 'Filtros de pagador inválidos' USING ERRCODE = '22023';
  END IF;
  IF payer_id_text IS NOT NULL THEN
    IF payer_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Pagador inválido' USING ERRCODE = '22023';
    END IF;
    selected_payer := payer_id_text::uuid;
    IF NOT EXISTS (SELECT 1 FROM finance_wallet_participants WHERE id = selected_payer AND finance_user_id = ANY(wallets)) THEN
      RAISE EXCEPTION 'Pagador não autorizado nesta carteira' USING ERRCODE = '42501';
    END IF;
  END IF;
  requested_view := coalesce(p_values ->> 'view', 'active');
  page_number := coalesce((p_values ->> 'page')::integer, 1);
  month_start := ((p_values ->> 'month') || '-01')::date;
  month_end := (month_start + interval '1 month')::date;
  date_from := nullif(p_values ->> 'date_from', '')::date;
  date_to := nullif(p_values ->> 'date_to', '')::date;
  search_text := nullif(btrim(p_values ->> 'q'), '');
  category_name := nullif(p_values ->> 'category', '');
  selected_type := nullif(p_values ->> 'type', '');
  IF requested_view = 'active' AND date_from IS NULL AND date_to IS NULL THEN
    date_from := month_start;
    date_to := month_end - 1;
  END IF;
  -- Display labels are not identity anchors. Do not return contact fields or phone-like names.
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'finance_user_id', p.finance_user_id, 'active', p.active,
    'display_name', coalesce(nullif(btrim(regexp_replace(regexp_replace(p.display_name,
      '[[:cntrl:]]', '', 'g'), '[+]?[0-9][0-9 ()+.-]{6,}[0-9](@s[.]whatsapp[.]net)?', '', 'g')), ''), 'Participante')
  ) ORDER BY p.finance_user_id, p.id), '[]'::jsonb) INTO people
    FROM finance_wallet_participants p WHERE p.finance_user_id = ANY(wallets);

  SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.transaction_date DESC, x.created_at DESC, x.id DESC), '[]'::jsonb)
    INTO rows_json
  FROM (
    SELECT t.*, false is_owner, false is_shared, true read_only,
      'Finanças do casal'::text owner_name, normalized.payer
    FROM finance_transactions t
    LEFT JOIN finance_transaction_attributions a
      ON a.transaction_id = t.id AND a.finance_user_id = t.user_id AND t.transaction_type = 'despesa'
    LEFT JOIN LATERAL (
      SELECT count(p.id)::integer valid_count, count(DISTINCT wanted.id)::integer unique_count,
        coalesce(jsonb_agg(wanted.id ORDER BY wanted.position), '[]'::jsonb) ids,
        coalesce(jsonb_agg(coalesce(nullif(btrim(regexp_replace(regexp_replace(p.display_name,
          '[[:cntrl:]]', '', 'g'), '[+]?[0-9][0-9 ()+.-]{6,}[0-9](@s[.]whatsapp[.]net)?', '', 'g')), ''), 'Participante')
          ORDER BY wanted.position) FILTER (WHERE p.id IS NOT NULL), '[]'::jsonb) labels
      FROM unnest(a.participant_ids) WITH ORDINALITY AS wanted(id, position)
      LEFT JOIN finance_wallet_participants p ON p.id = wanted.id AND p.finance_user_id = t.user_id
    ) resolved ON true
    CROSS JOIN LATERAL (
      SELECT CASE
        WHEN t.transaction_type = 'despesa' AND a.kind IN ('participant', 'joint')
          AND coalesce(array_ndims(a.participant_ids), 1) = 1
          AND ((a.kind = 'participant' AND cardinality(a.participant_ids) = 1)
            OR (a.kind = 'joint' AND cardinality(a.participant_ids) BETWEEN 2 AND 20))
          AND resolved.valid_count = cardinality(a.participant_ids)
          AND resolved.unique_count = cardinality(a.participant_ids)
        THEN jsonb_build_object('kind', a.kind, 'participant_ids', resolved.ids, 'labels', resolved.labels)
        ELSE jsonb_build_object('kind', 'unknown', 'participant_ids', '[]'::jsonb, 'labels', '[]'::jsonb)
      END AS payer
    ) normalized
    WHERE t.user_id = ANY(wallets)
      AND ((requested_view = 'active' AND t.deleted_at IS NULL)
        OR (requested_view = 'trash' AND t.deleted_at > now() - interval '30 days'))
      AND (search_text IS NULL OR t.description ILIKE '%' || search_text || '%')
      AND (category_name IS NULL OR t.category = category_name)
      AND (selected_type IS NULL OR t.transaction_type = selected_type)
      AND (date_from IS NULL OR t.transaction_date >= date_from)
      AND (date_to IS NULL OR t.transaction_date <= date_to)
      AND (payer_kind = 'all' OR (t.transaction_type = 'despesa' AND normalized.payer ->> 'kind' = payer_kind))
      AND (selected_payer IS NULL OR normalized.payer -> 'participant_ids' @> jsonb_build_array(selected_payer))
    ORDER BY t.transaction_date DESC, t.created_at DESC, t.id DESC
    OFFSET (page_number - 1) * page_size LIMIT page_size + 1
  ) x;
  RETURN original || jsonb_build_object(
    'transactions', (SELECT coalesce(jsonb_agg(value ORDER BY position), '[]'::jsonb)
      FROM jsonb_array_elements(rows_json) WITH ORDINALITY AS items(value, position) WHERE position <= page_size),
    'pagination', jsonb_build_object('page', page_number, 'pageSize', page_size, 'hasMore', jsonb_array_length(rows_json) > page_size),
    'payer_participants', people
  );
END $$;
REVOKE ALL ON FUNCTION public.finance_dashboard_couple_payer_transactions(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finance_dashboard_couple_payer_transactions(uuid, jsonb)
  TO service_role;
