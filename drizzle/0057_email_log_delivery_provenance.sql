alter table label_suite.email_logs
  add column if not exists provider text not null default 'brevo',
  add column if not exists operator_id text references label_suite."user"(id);
--> statement-breakpoint

create index if not exists email_logs_provider_idx on label_suite.email_logs using btree (provider);
create index if not exists email_logs_operator_id_idx on label_suite.email_logs using btree (operator_id);
