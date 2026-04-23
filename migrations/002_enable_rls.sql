ALTER TABLE external_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE drops ENABLE ROW LEVEL SECURITY;
ALTER TABLE brokers ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE broker_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_external_shifts ON external_shifts;
DROP POLICY IF EXISTS deny_drops ON drops;
DROP POLICY IF EXISTS deny_brokers ON brokers;
DROP POLICY IF EXISTS deny_queue_entries ON queue_entries;
DROP POLICY IF EXISTS deny_broker_attendance ON broker_attendance;
DROP POLICY IF EXISTS deny_leads ON leads;

CREATE POLICY deny_external_shifts ON external_shifts FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY deny_drops ON drops FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY deny_brokers ON brokers FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY deny_queue_entries ON queue_entries FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY deny_broker_attendance ON broker_attendance FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY deny_leads ON leads FOR ALL USING (false) WITH CHECK (false);
