import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cwahfoeehmlppifffapx.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3YWhmb2VlaG1scHBpZmZmYXB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2OTA1NTcsImV4cCI6MjEwODI2NjU1N30.mDmG8cg3-wMATYEPgq_Cz6U7UD18qYPZUy5nms4yVqI';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log('=== SAMPLE INCOMING INSURANCE RECORD ===');
  const { data: incoming } = await supabase.from('incoming_insurance_records').select('*').limit(3);
  console.log('incoming sample:', incoming);

  console.log('=== DISTINCT COMPANY ACCOUNTS IN EMPLOYEES_MASTER ===');
  const { data: accounts } = await supabase.from('employees_master').select('company_account');
  const uniqueAccs = new Set(accounts?.map(a => a.company_account));
  console.log('Accounts in master:', Array.from(uniqueAccs));

  console.log('=== DISTINCT COMPANY ACCOUNTS IN INCOMING_INSURANCE ===');
  const { data: incAccounts } = await supabase.from('incoming_insurance_records').select('company_account');
  const uniqueIncAccs = new Set(incAccounts?.map(a => a.company_account));
  console.log('Accounts in incoming:', Array.from(uniqueIncAccs));

  console.log('=== SAMPLE IMPORT LOGS ===');
  const { data: logs } = await supabase.from('import_logs').select('*').order('created_at', { ascending: false }).limit(10);
  console.log('Latest import logs:', logs?.map(l => ({ file_name: l.file_name, source_type: l.source_type, sheet_name: l.sheet_name, total_rows_read: l.total_rows_read })));
}

main().catch(console.error);
