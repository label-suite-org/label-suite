-- Synthetic fixture for scripts/verify-native-catalog-fixture.ts.
-- Apply ONLY to a new disposable database named native_catalog_fixture.
CREATE SCHEMA label_suite;
CREATE TABLE label_suite.releases(id text,org_id text,title text);
CREATE TABLE label_suite.catalog_entries(id text,org_id text,catalog_number text,entry_type text,title text,release_date text,status text,notes text,release_id text,sort_position integer,created_at timestamp);
INSERT INTO label_suite.releases VALUES ('release-a','org-a','Release A'),('release-b','org-b','Foreign Release');
INSERT INTO label_suite.catalog_entries SELECT 'catalog-'||lpad(n::text,3,'0'),'org-a','TN-'||lpad(n::text,3,'0'),'release',CASE WHEN n=151 THEN 'Entry 151 %_'||chr(92) ELSE 'Entry '||n END,to_char(date '2026-01-01'+n,'YYYY-MM-DD'),'published',null,CASE WHEN n IN (1,151) THEN 'release-a' WHEN n=3 THEN 'release-b' ELSE null END,n,now() FROM generate_series(1,151)n;
INSERT INTO label_suite.catalog_entries VALUES('foreign-catalog','org-b','TN-150','release','Foreign','2000-01-01','published',null,'release-b',1,now());
