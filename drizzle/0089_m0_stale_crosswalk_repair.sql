DO $$
DECLARE
  base_id constant text := 'appoKM3ylTDhR60LY';
  artist_source_id constant text := 'recnoDQP1nBajBOIX';
  release_source_id constant text := 'rec7o96GhS0vzIf9i';
  project_rows jsonb := '[
    {"id":"reccVVtGWsiyyG5AK","name":"True Blue - Star Witness & Fountain","status":"active"},
    {"id":"recpORhgpji9In0jq","name":"Japan/Tokyo Market Dev","status":"planning"},
    {"id":"recyfzeF6RkiIjVfo","name":null,"status":"completed"}
  ]'::jsonb;
  track_rows jsonb := '[
    {"id":"rec1CJn6AqQAgauTt","title":"The Crawl [Main]","release":"rectY2DGF5iT315Et","work":"recs5zdupcXsMiX9P","position":1,"version":"Main","duration":230},
    {"id":"rec1eNqhDUnaeKh64","title":"Amour Hardcore [Main]","release":"rec7o96GhS0vzIf9i","work":"rece3inDZQZDSd5Km","position":6,"version":"Main","duration":215},
    {"id":"rec3mOz2Vp7c0OpMf","title":"art deco (pesos) [Main]","release":"recrDN5x5RVHrwAFl","work":"recqqvHb0sLLhNkOn","position":1,"version":"Main","duration":196},
    {"id":"recDCXthjsWsPZva0","title":"i see fosho [Main]","release":"recrDN5x5RVHrwAFl","work":"rec4nIUUxxKapQIy8","position":6,"version":"Main","duration":314},
    {"id":"recEPJcTtq67tr6ho","title":"newgirl1.6 [Main]","release":"recrDN5x5RVHrwAFl","work":"recNZ7gIvp8lDWTaL","position":5,"version":"Main","duration":157},
    {"id":"recFTzRkkAqr51aJN","title":"Wild One [Main]","release":"rectY2DGF5iT315Et","work":"recmIuCEM4cIPmrYP","position":3,"version":"Main","duration":154},
    {"id":"recI3StF4ytyT933X","title":"No Dogs [Main]","release":"rectY2DGF5iT315Et","work":"recnHnDiWTCsOR89n","position":7,"version":"Main","duration":265},
    {"id":"recJQuD5SF4Uydgky","title":"Heart Kick [Main]","release":"rectY2DGF5iT315Et","work":"recvHWUfu50sFldxf","position":10,"version":"Main","duration":233},
    {"id":"recLe7tOh4xTvxLtx","title":"Arc  [Main]","release":"rectY2DGF5iT315Et","work":"recMyTmaAq9UUF4LM","position":6,"version":"Main","duration":153},
    {"id":"recMIvlDeYeMXTpup","title":"Passions on the rise [Main]","release":"rec7o96GhS0vzIf9i","work":"recHfw3hVGRwZBbkd","position":4,"version":"Main","duration":170},
    {"id":"recOeZQ1yL09zGEFU","title":"Smokeshow [Main]","release":"rec7o96GhS0vzIf9i","work":"recMCmM8w2O9SjYCw","position":3,"version":"Main","duration":189},
    {"id":"recPT9M50Bjyil8Jz","title":"Serenity [Main]","release":"rec7o96GhS0vzIf9i","work":"receWx0ZEtSattgrf","position":5,"version":"Main","duration":79},
    {"id":"recQ623pvrYg69mZ4","title":"Posters [Main]","release":"rec3CMbZdwsSQgprG","work":"recvetYM7RMhQrqQX","position":5,"version":"Main","duration":291},
    {"id":"recW6PtLS1ahA1aXK","title":"No flex [Main]","release":"rectY2DGF5iT315Et","work":"recU7SB1rzUEYm6rj","position":8,"version":"Main","duration":null},
    {"id":"recd9Y4sAkW4yH3OX","title":"Inside Out  [Main]","release":"rectY2DGF5iT315Et","work":"recLzK5CWNla58Bvi","position":2,"version":"Main","duration":213},
    {"id":"recgWjk94KrPOVDFt","title":"Mystique [Main]","release":"rec7o96GhS0vzIf9i","work":"recSTLn2m6CjXJN4Y","position":1,"version":"Main","duration":188},
    {"id":"recjeHIFfFmiz9ezj","title":"What was in the well [Main]","release":"rec7o96GhS0vzIf9i","work":"recxOSHYIaXKV3EV2","position":2,"version":"Main","duration":158},
    {"id":"recozkyuct08PVS1u","title":"Flood [Main]","release":"rectY2DGF5iT315Et","work":"recOLtYFp1daCb545","position":9,"version":"Main","duration":110},
    {"id":"recpFVBCzElPtS0e9","title":"No Reflection country vs [Main]","release":"rectY2DGF5iT315Et","work":"rectXhuBTbKTtqFmu","position":4,"version":"Main","duration":275},
    {"id":"recviNTpN0zDpqoJ2","title":"Dubai [Main]","release":"rectY2DGF5iT315Et","work":"rec5tRG2JCypZ4zA5","position":5,"version":"Main","duration":186},
    {"id":"recvzpXdlcLDVmdTL","title":"plastic grapes  [Main]","release":"recrDN5x5RVHrwAFl","work":"recx3WH7QdNopEpZi","position":4,"version":"Main","duration":196},
    {"id":"recw5VD8zNIwUkkdz","title":"Pure Love Forever  [Main]","release":"rectY2DGF5iT315Et","work":"recxDWk8RUQZGHWPH","position":11,"version":"Main","duration":142},
    {"id":"recwQrHEfAAlrgN3T","title":"Diamonds On My Watch [Main]","release":"rec3CMbZdwsSQgprG","work":"recaAY0O6kA52B5Cr","position":2,"version":"Main","duration":null},
    {"id":"recxqKdCEs7vzZd7p","title":"deepcuts [Main]","release":"recrDN5x5RVHrwAFl","work":"recVP4H9LURjJ8NLr","position":3,"version":"Main","duration":220}
  ]'::jsonb;
  role_rows jsonb := '[
    {"id":"rec5spkWCClAdbrgP","work":"recMMknzvkNvZRUkk","contributor":"recFVdQbWqG5EYXW4","contributor_kind":"organization","role":"Producer","ownership":"Rights","scope":"Master","share":50,"clearance":"Signed"},
    {"id":"rec6DvMgE9TSRGTnr","work":"recG0XLBVzIacw1wx","contributor":"recsorOjyNwVzAX7y","contributor_kind":"unmapped","role":"Co. Producer","ownership":"Rights","scope":"Master","share":5,"clearance":"Pending"},
    {"id":"recQb2xQLbAMDIWv3","work":"recbheWb82VzewCCr","contributor":"recFVdQbWqG5EYXW4","contributor_kind":"organization","role":"Producer","ownership":"Rights","scope":null,"share":null,"clearance":"Unknown"},
    {"id":"recSOEmwuPGsSxYiM","work":"recj0NJnuHjJBVz7L","contributor":"recFVdQbWqG5EYXW4","contributor_kind":"organization","role":"Producer","ownership":"Rights","scope":null,"share":null,"clearance":"Unknown"},
    {"id":"recYQhvHTD7zoRUdT","work":"recMMknzvkNvZRUkk","contributor":"recyQtiDxwdwFBBsr","contributor_kind":"contact","role":"Producer","ownership":"Rights","scope":"Master","share":50,"clearance":"Signed"},
    {"id":"recpw2xs4V8x3DyzK","work":"recjNbP93cSmbkxhZ","contributor":"recwIXqAnHrX4zjhV","contributor_kind":"contact","role":"Executive Producer","ownership":"Rights","scope":"Master","share":30,"clearance":"Confirmed"},
    {"id":"recr33kpPkWePxMu4","work":"recjNbP93cSmbkxhZ","contributor":"recyQtiDxwdwFBBsr","contributor_kind":"contact","role":"Executive Producer","ownership":"Rights","scope":"Master","share":30,"clearance":"Confirmed"},
    {"id":"recwliyCmBZ4ODxeB","work":"recj0NJnuHjJBVz7L","contributor":"rechsfS89rOhCLNPh","contributor_kind":"contact","role":"Producer","ownership":"Rights","scope":null,"share":null,"clearance":"Unknown"},
    {"id":"recx5PegUtZgV5JBT","work":"rec6bLy9ou3HVwJpg","contributor":"rechsfS89rOhCLNPh","contributor_kind":"contact","role":"Co. Producer","ownership":"Rights","scope":"Master","share":25,"clearance":"Unknown"}
  ]'::jsonb;
  affected integer;
BEGIN
  IF jsonb_array_length(project_rows) <> 3
     OR jsonb_array_length(track_rows) <> 24
     OR jsonb_array_length(role_rows) <> 9 THEN
    RAISE EXCEPTION 'M0 stale crosswalk evidence ledger is incomplete';
  END IF;

  SELECT count(*) INTO affected
  FROM label_suite.airtable_record_mappings mapping
  WHERE mapping.org_id = 'true-nature'
    AND mapping.airtable_base_id = base_id
    AND (
      (mapping.airtable_table_name = 'Artists' AND mapping.airtable_record_id = artist_source_id)
      OR (mapping.airtable_table_name = 'Projects' AND mapping.airtable_record_id IN (
        SELECT row.id FROM jsonb_to_recordset(project_rows) AS row(id text)
      ))
      OR (mapping.airtable_table_name = 'Releases (And Artist Events)' AND mapping.airtable_record_id = release_source_id)
      OR (mapping.airtable_table_name = 'Release Tracks' AND mapping.airtable_record_id IN (
        SELECT row.id FROM jsonb_to_recordset(track_rows) AS row(id text)
      ))
      OR (mapping.airtable_table_name = 'Rights Lines (Roles)' AND mapping.airtable_record_id IN (
        SELECT row.id FROM jsonb_to_recordset(role_rows) AS row(id text)
      ))
    );
  IF affected = 0 THEN
    RETURN;
  ELSIF affected <> 38 THEN
    RAISE EXCEPTION 'M0 stale crosswalk repair expected all 38 source mappings or a clean database, found %', affected;
  END IF;

  SELECT count(*) INTO affected
  FROM label_suite.airtable_record_mappings mapping
  WHERE mapping.org_id = 'true-nature'
    AND mapping.airtable_base_id = base_id
    AND mapping.postgres_record_id = mapping.airtable_record_id
    AND mapping.import_batch_id IS NOT NULL
    AND mapping.record_hash IS NOT NULL
    AND (
      (mapping.airtable_table_name = 'Artists' AND mapping.airtable_record_id = artist_source_id AND mapping.postgres_table_name = 'artists')
      OR (mapping.airtable_table_name = 'Projects' AND mapping.airtable_record_id IN (
        SELECT row.id FROM jsonb_to_recordset(project_rows) AS row(id text)
      ) AND mapping.postgres_table_name = 'budget_projects')
      OR (mapping.airtable_table_name = 'Releases (And Artist Events)' AND mapping.airtable_record_id = release_source_id AND mapping.postgres_table_name = 'releases')
      OR (mapping.airtable_table_name = 'Release Tracks' AND mapping.airtable_record_id IN (
        SELECT row.id FROM jsonb_to_recordset(track_rows) AS row(id text)
      ) AND mapping.postgres_table_name = 'tracks')
      OR (mapping.airtable_table_name = 'Rights Lines (Roles)' AND mapping.airtable_record_id IN (
        SELECT row.id FROM jsonb_to_recordset(role_rows) AS row(id text)
      ) AND mapping.postgres_table_name = 'roles')
    );
  IF affected <> 38 THEN
    RAISE EXCEPTION 'M0 stale crosswalk mappings no longer match the reviewed import ledger';
  END IF;

  SELECT count(*) INTO affected
  FROM (
    SELECT id FROM label_suite.artists WHERE org_id = 'true-nature' AND id = artist_source_id
    UNION ALL
    SELECT id FROM label_suite.budget_projects WHERE org_id = 'true-nature' AND id IN (
      SELECT row.id FROM jsonb_to_recordset(project_rows) AS row(id text)
    )
    UNION ALL
    SELECT id FROM label_suite.releases WHERE org_id = 'true-nature' AND id = release_source_id
    UNION ALL
    SELECT id FROM label_suite.tracks WHERE org_id = 'true-nature' AND id IN (
      SELECT row.id FROM jsonb_to_recordset(track_rows) AS row(id text)
    )
    UNION ALL
    SELECT id FROM label_suite.roles WHERE org_id = 'true-nature' AND id IN (
      SELECT row.id FROM jsonb_to_recordset(role_rows) AS row(id text)
    )
  ) existing_targets;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'M0 stale crosswalk repair found % partially restored canonical targets', affected;
  END IF;

  SELECT count(*) INTO affected
  FROM label_suite.data_quality_issues
  WHERE org_id = 'true-nature'
    AND id IN (
      'm0-empty-project-recyfzeF6RkiIjVfo',
      'm0-role-contributor-rec5spkWCClAdbrgP',
      'm0-role-contributor-rec6DvMgE9TSRGTnr',
      'm0-role-contributor-recQb2xQLbAMDIWv3',
      'm0-role-contributor-recSOEmwuPGsSxYiM'
    );
  IF affected <> 0 THEN
    RAISE EXCEPTION 'M0 stale crosswalk data-quality evidence is already partially present';
  END IF;

  SELECT count(*) INTO affected
  FROM label_suite.catalog_entries
  WHERE org_id = 'true-nature'
    AND (release_id = release_source_id OR catalog_number = 'TNR-007');
  IF affected <> 0 THEN
    RAISE EXCEPTION 'Scarred Angel catalog evidence conflicts with an existing canonical catalog entry';
  END IF;

  SELECT count(*) INTO affected
  FROM label_suite.airtable_record_mappings mapping
  JOIN label_suite.artists artist
    ON artist.org_id = mapping.org_id
   AND artist.id = mapping.postgres_record_id
  WHERE mapping.org_id = 'true-nature'
    AND mapping.airtable_base_id = base_id
    AND mapping.airtable_table_name = 'Artists'
    AND mapping.airtable_record_id = 'recZSDkbhOcn5g6BH'
    AND mapping.postgres_table_name = 'artists';
  IF affected <> 1 THEN
    RAISE EXCEPTION 'Scarred Angel source artist does not resolve to one tenant-scoped canonical artist';
  END IF;

  SELECT count(*) INTO affected
  FROM jsonb_to_recordset(role_rows) AS source(
    id text, work text, contributor text, contributor_kind text,
    role text, ownership text, scope text, share real, clearance text
  )
  JOIN label_suite.airtable_record_mappings mapping
    ON mapping.org_id = 'true-nature'
   AND mapping.airtable_base_id = base_id
   AND mapping.airtable_table_name = 'Contacts'
   AND mapping.airtable_record_id = source.contributor
   AND mapping.postgres_table_name = 'contacts'
  JOIN label_suite.contacts contact
    ON contact.org_id = mapping.org_id
   AND contact.id = mapping.postgres_record_id
  WHERE source.contributor_kind = 'contact';
  IF affected <> 5 THEN
    RAISE EXCEPTION 'Expected five role contributors with exact tenant-scoped contact mappings, found %', affected;
  END IF;

  SELECT count(*) INTO affected
  FROM jsonb_to_recordset(role_rows) AS source(
    id text, work text, contributor text, contributor_kind text,
    role text, ownership text, scope text, share real, clearance text
  )
  JOIN label_suite.airtable_record_mappings mapping
    ON mapping.org_id = 'true-nature'
   AND mapping.airtable_base_id = base_id
   AND mapping.airtable_table_name = 'Contacts'
   AND mapping.airtable_record_id = source.contributor
   AND mapping.postgres_table_name = 'organizations'
  JOIN label_suite.organizations organization
    ON organization.org_id = mapping.org_id
   AND organization.id = mapping.postgres_record_id
  WHERE source.contributor_kind = 'organization';
  IF affected <> 3 THEN
    RAISE EXCEPTION 'Expected three role rows whose exact contributor maps to an organization, found %', affected;
  END IF;

  SELECT count(*) INTO affected
  FROM label_suite.airtable_record_mappings mapping
  WHERE mapping.org_id = 'true-nature'
    AND mapping.airtable_base_id = base_id
    AND mapping.airtable_table_name = 'Contacts'
    AND mapping.airtable_record_id = 'recsorOjyNwVzAX7y';
  IF affected <> 0 THEN
    RAISE EXCEPTION 'Previously unmapped role contributor now has a source mapping; re-review before repair';
  END IF;

  INSERT INTO label_suite.artists (id, org_id, name, created_at, updated_at)
  SELECT artist_source_id, 'true-nature', 'Dylan Hadley', mapping.imported_at, now()
  FROM label_suite.airtable_record_mappings mapping
  WHERE mapping.org_id = 'true-nature'
    AND mapping.airtable_base_id = base_id
    AND mapping.airtable_table_name = 'Artists'
    AND mapping.airtable_record_id = artist_source_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'Expected to restore one source-evidenced artist, inserted %', affected;
  END IF;

  INSERT INTO label_suite.budget_projects (
    id, org_id, name, project_type, status, currency,
    source_system, source_base_id, source_record_id, source_imported_at,
    created_at, updated_at
  )
  SELECT
    source.id,
    'true-nature',
    source.name,
    'release',
    source.status,
    'USD',
    'airtable',
    base_id,
    source.id,
    mapping.imported_at,
    mapping.imported_at,
    now()
  FROM jsonb_to_recordset(project_rows) AS source(id text, name text, status text)
  JOIN label_suite.airtable_record_mappings mapping
    ON mapping.org_id = 'true-nature'
   AND mapping.airtable_base_id = base_id
   AND mapping.airtable_table_name = 'Projects'
   AND mapping.airtable_record_id = source.id
  WHERE source.name IS NOT NULL;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 2 THEN
    RAISE EXCEPTION 'Expected to restore two named source-evidenced projects, inserted %', affected;
  END IF;

  INSERT INTO label_suite.data_quality_issues (
    id, org_id, source, issue_type, idempotency_key, priority, status,
    external_object_type, external_object_id, details, created_at, updated_at
  ) VALUES (
    'm0-empty-project-recyfzeF6RkiIjVfo',
    'true-nature',
    'airtable',
    'empty_project',
    'airtable:appoKM3ylTDhR60LY:Projects:recyfzeF6RkiIjVfo:empty',
    'P1',
    'triaged',
    'airtable_project',
    'recyfzeF6RkiIjVfo',
    jsonb_build_object(
      'airtableBaseId', base_id,
      'airtableTable', 'Projects',
      'reason', 'Source row has no project name or linked canonical identity; no placeholder was restored.',
      'trackingIssue', 377
    ),
    now(),
    now()
  );

  UPDATE label_suite.airtable_record_mappings
  SET postgres_table_name = 'data_quality_issues',
      postgres_record_id = 'm0-empty-project-recyfzeF6RkiIjVfo',
      updated_at = now()
  WHERE org_id = 'true-nature'
    AND airtable_base_id = base_id
    AND airtable_table_name = 'Projects'
    AND airtable_record_id = 'recyfzeF6RkiIjVfo'
    AND postgres_table_name = 'budget_projects'
    AND postgres_record_id = 'recyfzeF6RkiIjVfo';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'Expected to quarantine one empty project source mapping, updated %', affected;
  END IF;

  INSERT INTO label_suite.releases (
    id, org_id, title, artist_id, release_date, format, status,
    delivery_status, exploitation_scope, created_at, updated_at
  )
  SELECT
    release_source_id,
    'true-nature',
    'Scarred Angel',
    artist_mapping.postgres_record_id,
    '2026-07-31',
    'EP',
    'In Production',
    'In Production',
    'DSP Only',
    release_mapping.imported_at,
    now()
  FROM label_suite.airtable_record_mappings release_mapping
  JOIN label_suite.airtable_record_mappings artist_mapping
    ON artist_mapping.org_id = release_mapping.org_id
   AND artist_mapping.airtable_base_id = release_mapping.airtable_base_id
   AND artist_mapping.airtable_table_name = 'Artists'
   AND artist_mapping.airtable_record_id = 'recZSDkbhOcn5g6BH'
   AND artist_mapping.postgres_table_name = 'artists'
  WHERE release_mapping.org_id = 'true-nature'
    AND release_mapping.airtable_base_id = base_id
    AND release_mapping.airtable_table_name = 'Releases (And Artist Events)'
    AND release_mapping.airtable_record_id = release_source_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'Expected to restore one catalog-evidenced release, inserted %', affected;
  END IF;

  INSERT INTO label_suite.catalog_entries (
    id, org_id, entry_type, title, release_id, release_date, status,
    catalog_number, catalog_number_locked, catalog_number_source,
    sort_position, notes, created_at, updated_at
  )
  SELECT
    'airtable-release:' || release_source_id,
    'true-nature',
    'release',
    'Scarred Angel',
    release_source_id,
    '2026-07-31',
    'planned',
    'TNR-007',
    true,
    'airtable',
    0,
    'Restored from exact Airtable release and catalog-number evidence during M0 crosswalk repair.',
    mapping.imported_at,
    now()
  FROM label_suite.airtable_record_mappings mapping
  WHERE mapping.org_id = 'true-nature'
    AND mapping.airtable_base_id = base_id
    AND mapping.airtable_table_name = 'Releases (And Artist Events)'
    AND mapping.airtable_record_id = release_source_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 1 THEN
    RAISE EXCEPTION 'Expected to restore one catalog entry from TNR-007 evidence, inserted %', affected;
  END IF;

  SELECT count(*) INTO affected
  FROM jsonb_to_recordset(track_rows) AS source(
    id text, title text, release text, work text,
    position integer, version text, duration integer
  )
  JOIN label_suite.airtable_record_mappings release_mapping
    ON release_mapping.org_id = 'true-nature'
   AND release_mapping.airtable_base_id = base_id
   AND release_mapping.airtable_table_name = 'Releases (And Artist Events)'
   AND release_mapping.airtable_record_id = source.release
   AND release_mapping.postgres_table_name = 'releases'
  JOIN label_suite.releases release
    ON release.org_id = release_mapping.org_id
   AND release.id = release_mapping.postgres_record_id
  JOIN label_suite.airtable_record_mappings work_mapping
    ON work_mapping.org_id = release_mapping.org_id
   AND work_mapping.airtable_base_id = release_mapping.airtable_base_id
   AND work_mapping.airtable_table_name = 'Recordings (Masters)'
   AND work_mapping.airtable_record_id = source.work
   AND work_mapping.postgres_table_name = 'works'
  JOIN label_suite.works work
    ON work.org_id = work_mapping.org_id
   AND work.id = work_mapping.postgres_record_id;
  IF affected <> 24 THEN
    RAISE EXCEPTION 'Expected 24 tracks with exact tenant-scoped release/work mappings, found %', affected;
  END IF;

  SELECT count(*) INTO affected
  FROM jsonb_to_recordset(track_rows) AS source(
    id text, title text, release text, work text,
    position integer, version text, duration integer
  )
  JOIN label_suite.airtable_record_mappings release_mapping
    ON release_mapping.org_id = 'true-nature'
   AND release_mapping.airtable_base_id = base_id
   AND release_mapping.airtable_table_name = 'Releases (And Artist Events)'
   AND release_mapping.airtable_record_id = source.release
   AND release_mapping.postgres_table_name = 'releases'
  JOIN label_suite.airtable_record_mappings work_mapping
    ON work_mapping.org_id = release_mapping.org_id
   AND work_mapping.airtable_base_id = release_mapping.airtable_base_id
   AND work_mapping.airtable_table_name = 'Recordings (Masters)'
   AND work_mapping.airtable_record_id = source.work
   AND work_mapping.postgres_table_name = 'works'
  JOIN label_suite.tracks track
    ON track.org_id = release_mapping.org_id
   AND track.release_id = release_mapping.postgres_record_id
   AND track.work_id = work_mapping.postgres_record_id;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'Exact release/work evidence already resolves % reviewed tracks; re-review before repair', affected;
  END IF;

  INSERT INTO label_suite.tracks (
    id, org_id, title, release_id, work_id, position, version, duration,
    created_at, updated_at
  )
  SELECT
    source.id,
    'true-nature',
    source.title,
    release_mapping.postgres_record_id,
    work_mapping.postgres_record_id,
    source.position,
    source.version,
    source.duration,
    source_mapping.imported_at,
    now()
  FROM jsonb_to_recordset(track_rows) AS source(
    id text, title text, release text, work text,
    position integer, version text, duration integer
  )
  JOIN label_suite.airtable_record_mappings source_mapping
    ON source_mapping.org_id = 'true-nature'
   AND source_mapping.airtable_base_id = base_id
   AND source_mapping.airtable_table_name = 'Release Tracks'
   AND source_mapping.airtable_record_id = source.id
  JOIN label_suite.airtable_record_mappings release_mapping
    ON release_mapping.org_id = source_mapping.org_id
   AND release_mapping.airtable_base_id = source_mapping.airtable_base_id
   AND release_mapping.airtable_table_name = 'Releases (And Artist Events)'
   AND release_mapping.airtable_record_id = source.release
   AND release_mapping.postgres_table_name = 'releases'
  JOIN label_suite.airtable_record_mappings work_mapping
    ON work_mapping.org_id = source_mapping.org_id
   AND work_mapping.airtable_base_id = source_mapping.airtable_base_id
   AND work_mapping.airtable_table_name = 'Recordings (Masters)'
   AND work_mapping.airtable_record_id = source.work
   AND work_mapping.postgres_table_name = 'works';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 24 THEN
    RAISE EXCEPTION 'Expected to restore 24 exact release/work tracks, inserted %', affected;
  END IF;

  SELECT count(*) INTO affected
  FROM jsonb_to_recordset(role_rows) AS source(
    id text, work text, contributor text, contributor_kind text,
    role text, ownership text, scope text, share real, clearance text
  )
  JOIN label_suite.airtable_record_mappings work_mapping
    ON work_mapping.org_id = 'true-nature'
   AND work_mapping.airtable_base_id = base_id
   AND work_mapping.airtable_table_name = 'Recordings (Masters)'
   AND work_mapping.airtable_record_id = source.work
   AND work_mapping.postgres_table_name = 'works'
  JOIN label_suite.works work
    ON work.org_id = work_mapping.org_id
   AND work.id = work_mapping.postgres_record_id;
  IF affected <> 9 THEN
    RAISE EXCEPTION 'Expected nine rights rows with exact tenant-scoped work mappings, found %', affected;
  END IF;

  SELECT count(*) INTO affected
  FROM jsonb_to_recordset(role_rows) AS source(
    id text, work text, contributor text, contributor_kind text,
    role text, ownership text, scope text, share real, clearance text
  )
  JOIN label_suite.airtable_record_mappings work_mapping
    ON work_mapping.org_id = 'true-nature'
   AND work_mapping.airtable_base_id = base_id
   AND work_mapping.airtable_table_name = 'Recordings (Masters)'
   AND work_mapping.airtable_record_id = source.work
   AND work_mapping.postgres_table_name = 'works'
  LEFT JOIN label_suite.airtable_record_mappings contact_mapping
    ON contact_mapping.org_id = work_mapping.org_id
   AND contact_mapping.airtable_base_id = work_mapping.airtable_base_id
   AND contact_mapping.airtable_table_name = 'Contacts'
   AND contact_mapping.airtable_record_id = source.contributor
   AND contact_mapping.postgres_table_name = 'contacts'
   AND source.contributor_kind = 'contact'
  JOIN label_suite.roles role
    ON role.org_id = work_mapping.org_id
   AND role.work_id = work_mapping.postgres_record_id
   AND role.contact_id IS NOT DISTINCT FROM contact_mapping.postgres_record_id
   AND role.role IS NOT DISTINCT FROM source.role
   AND role.ownership_type IS NOT DISTINCT FROM source.ownership
   AND role.scope IS NOT DISTINCT FROM source.scope
   AND role.percent_share IS NOT DISTINCT FROM source.share
   AND role.clearance_status IS NOT DISTINCT FROM source.clearance;
  IF affected <> 0 THEN
    RAISE EXCEPTION 'Exact work/contributor rights evidence already resolves % reviewed roles; re-review before repair', affected;
  END IF;

  INSERT INTO label_suite.roles (
    id, org_id, contact_id, work_id, role, ownership_type, scope,
    percent_share, clearance_status, created_at, updated_at
  )
  SELECT
    source.id,
    'true-nature',
    CASE WHEN source.contributor_kind = 'contact' THEN contact.id ELSE NULL END,
    work_mapping.postgres_record_id,
    source.role,
    source.ownership,
    source.scope,
    source.share,
    source.clearance,
    source_mapping.imported_at,
    now()
  FROM jsonb_to_recordset(role_rows) AS source(
    id text, work text, contributor text, contributor_kind text,
    role text, ownership text, scope text, share real, clearance text
  )
  JOIN label_suite.airtable_record_mappings source_mapping
    ON source_mapping.org_id = 'true-nature'
   AND source_mapping.airtable_base_id = base_id
   AND source_mapping.airtable_table_name = 'Rights Lines (Roles)'
   AND source_mapping.airtable_record_id = source.id
  JOIN label_suite.airtable_record_mappings work_mapping
    ON work_mapping.org_id = source_mapping.org_id
   AND work_mapping.airtable_base_id = source_mapping.airtable_base_id
   AND work_mapping.airtable_table_name = 'Recordings (Masters)'
   AND work_mapping.airtable_record_id = source.work
   AND work_mapping.postgres_table_name = 'works'
  LEFT JOIN label_suite.airtable_record_mappings contact_mapping
    ON contact_mapping.org_id = source_mapping.org_id
   AND contact_mapping.airtable_base_id = source_mapping.airtable_base_id
   AND contact_mapping.airtable_table_name = 'Contacts'
   AND contact_mapping.airtable_record_id = source.contributor
   AND contact_mapping.postgres_table_name = 'contacts'
   AND source.contributor_kind = 'contact'
  LEFT JOIN label_suite.contacts contact
    ON contact.org_id = contact_mapping.org_id
   AND contact.id = contact_mapping.postgres_record_id;
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 9 THEN
    RAISE EXCEPTION 'Expected to restore nine exact rights rows, inserted %', affected;
  END IF;

  INSERT INTO label_suite.data_quality_issues (
    id, org_id, source, issue_type, idempotency_key, priority, status,
    label_suite_object_type, label_suite_object_id,
    external_object_type, external_object_id, details, created_at, updated_at
  )
  SELECT
    'm0-role-contributor-' || source.id,
    'true-nature',
    'airtable',
    'unresolved_role_contributor',
    'airtable:' || base_id || ':Rights Lines (Roles):' || source.id || ':unresolved-contributor',
    'P1',
    'triaged',
    'role',
    source.id,
    'airtable_contact',
    source.contributor,
    jsonb_build_object(
      'airtableBaseId', base_id,
      'airtableTable', 'Rights Lines (Roles)',
      'reason', CASE source.contributor_kind
        WHEN 'organization' THEN 'Source contributor maps to an organization, while canonical roles currently accept contacts only; no unsupported identity coercion was applied.'
        ELSE 'Source contributor has no canonical contact mapping; no name or email inference was applied.'
      END,
      'trackingIssue', 376
    ),
    now(),
    now()
  FROM jsonb_to_recordset(role_rows) AS source(
    id text, work text, contributor text, contributor_kind text,
    role text, ownership text, scope text, share real, clearance text
  )
  WHERE source.contributor_kind <> 'contact';
  GET DIAGNOSTICS affected = ROW_COUNT;
  IF affected <> 4 THEN
    RAISE EXCEPTION 'Expected to record four unresolved role contributors, inserted %', affected;
  END IF;
END $$;
