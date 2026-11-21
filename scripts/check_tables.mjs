import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://cwahfoeehmlppifffapx.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3YWhmb2VlaG1scHBpZmZmYXB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2OTA1NTcsImV4cCI6MjEwODI2NjU1N30.mDmG8cg3-wMATYEPgq_Cz6U7UD18qYPZUy5nms4yVqI';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const tables = [
    'employees_master',
    'dynamic_sheets',
    'sheet_data',
    'employee_history',
    'matching_conflicts',
    'incoming_insurance_records',
    'monthly_insurance_records',
    'monthly_payroll_records',
    'resignation_records',
    'search_history'
  ];

  console.log('=== CHECKING SUPABASE TABLES ===');
  for (const t of tables) {
    const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
    if (error) {
      console.log(`Table ${t}: ERROR -> ${error.message}`);
    } else {
      console.log(`Table ${t}: ${count} rows`);
    }
  }

  const { data: sheets } = await supabase.from('dynamic_sheets').select('sheet_name, display_name, total_records_imported');
  console.log('\nDynamic sheets registered:');
  console.log(sheets);
}

main().catch(console.error);
