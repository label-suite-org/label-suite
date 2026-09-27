-- Synthetic only. Use a new disposable native_provider_fixture database.
CREATE SCHEMA label_suite;
CREATE TABLE label_suite.samply_projects(id text,org_id text,release_id text,remote_project_id text,remote_project_name text,upload_enabled boolean,primary_player_id text,last_synced_at timestamp,metadata jsonb,updated_at timestamp);
CREATE TABLE label_suite.samply_connections(org_id text,status text);
CREATE TABLE label_suite.samply_files(org_id text,samply_project_id text,sync_status text);
CREATE TABLE label_suite.dsp_pitches(id text,org_id text,platform text,status text,sent_date timestamp,response text,created_at timestamp);
CREATE TABLE label_suite.dsp_pitch_releases(org_id text,release_id text,dsp_pitch_id text);
INSERT INTO label_suite.samply_connections VALUES ('own','verified'),('foreign','failed'),('failed-org','failed');
INSERT INTO label_suite.samply_projects VALUES ('own-project','own','release-a','remote-a','Own',false,null,'2026-09-01',null,'2026-09-01'),('foreign-project','foreign','release-a','remote-b','Foreign',false,null,'2026-09-10',null,'2026-09-10'),('foreign-only','foreign','release-foreign','remote-c','Foreign only',false,null,'2026-09-10',null,'2026-09-10');
INSERT INTO label_suite.samply_files VALUES ('own','own-project','synced'),('own','own-project','pending'),('own','own-project','missing_remote'),('foreign','own-project','pending'),('foreign','foreign-project','pending');
INSERT INTO label_suite.dsp_pitches SELECT 'pitch-'||n,'own','Fixture DSP','draft',timestamp '2026-09-01'+n*interval '1 day',null,now() FROM generate_series(1,25)n;
INSERT INTO label_suite.dsp_pitch_releases SELECT 'own','release-a','pitch-'||n FROM generate_series(1,25)n;
INSERT INTO label_suite.dsp_pitches VALUES ('foreign-pitch','foreign','Must not leak','sent',now(),null,now());
INSERT INTO label_suite.dsp_pitch_releases VALUES ('own','release-a','foreign-pitch'),('foreign','release-a','pitch-1'),('foreign','release-foreign','foreign-pitch');
INSERT INTO label_suite.dsp_pitches SELECT 'draft-'||n,'own','Fixture DSP','draft',null,null,now() FROM generate_series(1,25)n;
INSERT INTO label_suite.dsp_pitch_releases SELECT 'own','release-a','draft-'||n FROM generate_series(1,25)n;
