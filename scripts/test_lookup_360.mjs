import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://cwahfoeehmlppifffapx.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN3YWhmb2VlaG1scHBpZmZmYXB4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2OTA1NTcsImV4cCI6MjEwODI2NjU1N30.mDmG8cg3-wMATYEPgq_Cz6U7UD18qYPZUy5nms4yVqI'
);

async function main() {
  const { data: d1, error: e1 } = await supabase.from('incoming_insurance_records').select('*').or('employee_code.eq.31003').limit(5);
  console.log('Result with .or():', d1?.length, e1 ? e1.message : 'no error');

  const { data: d2, error: e2 } = await supabase.from('incoming_insurance_records').select('*').eq('employee_code', '31003').limit(5);
  console.log('Result with .eq():', d2?.length, e2 ? e2.message : 'no error');
}

main().catch(console.error);
