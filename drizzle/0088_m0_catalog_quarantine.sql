DO $$
DECLARE
  samply_track_ids text[] := ARRAY[
    '19e201f3-d8ff-4d0f-8604-27356efe4db8',
    '19f80c94-1a83-4eb2-b2f5-c4ca0ca73366',
    '1a64f180-dab5-4f51-b5d6-91101613afe7',
    '1bf18d59-6eff-49c6-af3a-dc18dec92301',
    '1d0cad3e-4f54-4060-bd43-5ce5a191cb1d',
    '1f4e3147-4ba7-4b1b-9fc4-987df57dbe5b',
    '3626aeb9-d187-4659-a82c-2113fcfc2498',
    '3df49b3c-3b27-45f1-8172-d798ace968ca',
    '44b36c37-1a97-4d21-8466-7e62b4866970',
    '529e7b34-9386-4029-9a31-4d7876f50758',
    '52bc95d2-7f1e-4115-bcd7-ebd9d33d11cb',
    '57b5b85a-81d6-4ead-9175-9a5f353d2982',
    '5d4ba5da-837f-41bf-82f9-f738c3b52365',
    '5e50d08d-5d45-483c-84ce-df6bf294ab4c',
    '6eb4b774-490e-40c6-a5ec-cec7485ed238',
    '7c8626c8-491b-4aec-9687-ee2bb02ed313',
    '8165985a-1c10-4003-b8ae-3ef36b0ee494',
    '84ea6cf6-0f01-414c-81df-97e125cd0bb8',
    '8cce9e7f-2661-4464-8205-7e1ef01decc1',
    '94184faa-2b7b-4d5d-a30b-df97a745b5ec',
    'b8d714a7-499b-4151-be8b-7945ea6b7eed',
    'c864a66d-e9fb-4a0f-9fa9-90d9f4e04525',
    'd493d533-7a21-4cff-898a-f3984f97566a',
    'd5571a8f-d87d-4faa-81f0-7f5f42c17e2a',
    'e59211b8-6eca-494c-9196-4d677bf02d23',
    'e9d2ddbe-cfad-4999-9bbd-3c356a29f485',
    'ff78f832-c7c2-47a6-b3d9-96c91a1d90c5'
  ];
  invalid_track_ids text[];
  affected integer;
BEGIN
  invalid_track_ids := array_append(samply_track_ids, 'reca11K4TwjlqH1hP');

  IF array_length(samply_track_ids, 1) <> 27 OR array_length(invalid_track_ids, 1) <> 28 THEN
    RAISE EXCEPTION 'M0 catalog quarantine ID ledger is incomplete';
  END IF;

  SELECT count(*) INTO affected
  FROM label_suite.tracks
  WHERE org_id = 'true-nature' AND id = ANY(invalid_track_ids);
  IF affected = 0 THEN
    RETURN;
  ELSIF affected <> 28 THEN
    RAISE EXCEPTION 'M0 catalog quarantine expected all 28 reviewed rows or a clean database, found %', affected;
  END IF;

  SELECT count(*) INTO affected
  FROM label_suite.tracks
  WHERE org_id = 'true-nature'
    AND id = ANY(samply_track_ids)
    AND work_id IS NULL
    AND release_id IS NOT NULL;
  IF affected <> 27 THEN
    RAISE EXCEPTION 'Expected 27 evidenced Samply tracks without works, found %', affected;
  END IF;

  SELECT count(*) INTO affected
  FROM label_suite.tracks
  WHERE org_id = 'true-nature'
    AND id = 'reca11K4TwjlqH1hP'
    AND title = 'Airtable Track reca11K4TwjlqH1hP'
    AND work_id IS NULL
    AND release_id IS NULL
    AND audio_url IS NULL
    AND position IS NULL
    AND isrc IS NULL;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'Empty Airtable release-track placeholder no longer matches reviewed evidence';
  END IF;

  SELECT count(*) INTO affected
  FROM label_suite.airtable_record_mappings
  WHERE org_id = 'true-nature'
    AND airtable_base_id = 'appoKM3ylTDhR60LY'
    AND airtable_table_name = 'Release Tracks'
    AND airtable_record_id = 'reca11K4TwjlqH1hP'
    AND postgres_table_name = 'tracks'
    AND postgres_record_id = 'reca11K4TwjlqH1hP';
  IF affected <> 1 THEN
    RAISE EXCEPTION 'Expected one source mapping for the empty Airtable release-track row, found %', affected;
  END IF;

  SELECT count(*) INTO affected
  FROM label_suite.samply_files
  WHERE org_id = 'true-nature' AND track_id = ANY(samply_track_ids);
  IF affected <> 35 THEN
    RAISE EXCEPTION 'Expected 35 Samply file records for quarantine, found %', affected;
  END IF;

  SELECT count(DISTINCT track_id) INTO affected
  FROM label_suite.samply_files
  WHERE org_id = 'true-nature' AND track_id = ANY(samply_track_ids);
  IF affected <> 27 THEN
    RAISE EXCEPTION 'Every reviewed Samply track must retain file evidence; found % of 27', affected;
  END IF;

  SELECT count(*) INTO affected
  FROM (
    SELECT track_id FROM label_suite.analytics_import_runs WHERE track_id = ANY(invalid_track_ids)
    UNION ALL
    SELECT track_id FROM label_suite.analytics_import_files WHERE track_id = ANY(invalid_track_ids)
    UNION ALL
    SELECT track_id FROM label_suite.analytics_metric_rows WHERE track_id = ANY(invalid_track_ids)
    UNION ALL
    SELECT track_id FROM label_suite.analytics_metric_changes WHERE track_id = ANY(invalid_track_ids)
    UNION ALL
    SELECT track_id FROM label_suite.royalties_revenue WHERE track_id = ANY(invalid_track_ids)
    UNION ALL
    SELECT track_id FROM label_suite.royalty_earnings WHERE track_id = ANY(invalid_track_ids)
    UNION ALL
    SELECT track_id FROM label_suite.samply_comment_links WHERE track_id = ANY(invalid_track_ids)
    UNION ALL
    SELECT exact_edit_track_id FROM label_suite.campaign_leads WHERE exact_edit_track_id = ANY(invalid_track_ids)
  ) references_to_preserve;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'Reviewed invalid tracks gained % unsupported downstream references', affected;
  END IF;

  UPDATE label_suite.samply_files
  SET track_id = NULL,
      sync_status = 'unmatched',
      updated_at = now()
  WHERE org_id = 'true-nature' AND track_id = ANY(samply_track_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 35 THEN
    RAISE EXCEPTION 'Expected to quarantine 35 Samply file records, updated %', affected;
  END IF;

  INSERT INTO label_suite.data_quality_issues (
    id,
    org_id,
    source,
    issue_type,
    idempotency_key,
    priority,
    status,
    external_object_type,
    external_object_id,
    details,
    created_at,
    updated_at
  ) VALUES (
    'm0-empty-release-track-reca11K4TwjlqH1hP',
    'true-nature',
    'airtable',
    'empty_release_track',
    'airtable:appoKM3ylTDhR60LY:Release Tracks:reca11K4TwjlqH1hP:empty',
    'P1',
    'triaged',
    'airtable_release_track',
    'reca11K4TwjlqH1hP',
    jsonb_build_object(
      'airtableBaseId', 'appoKM3ylTDhR60LY',
      'airtableTable', 'Release Tracks',
      'reason', 'Source row is empty; no evidence supports a canonical release or work link.',
      'trackingIssue', 380
    ),
    now(),
    now()
  );

  UPDATE label_suite.airtable_record_mappings
  SET postgres_table_name = 'data_quality_issues',
      postgres_record_id = 'm0-empty-release-track-reca11K4TwjlqH1hP',
      updated_at = now()
  WHERE org_id = 'true-nature'
    AND airtable_base_id = 'appoKM3ylTDhR60LY'
    AND airtable_table_name = 'Release Tracks'
    AND airtable_record_id = 'reca11K4TwjlqH1hP'
    AND postgres_table_name = 'tracks'
    AND postgres_record_id = 'reca11K4TwjlqH1hP';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'Expected to quarantine one empty Airtable source mapping, updated %', affected;
  END IF;

  DELETE FROM label_suite.tracks
  WHERE org_id = 'true-nature' AND id = ANY(invalid_track_ids);
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 28 THEN
    RAISE EXCEPTION 'Expected to remove 28 invalid canonical track rows, deleted %', affected;
  END IF;
END $$;
