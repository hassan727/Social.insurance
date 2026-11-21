import { getEmployeeFullDetails } from '../lib/lookupService';

async function test() {
  console.log('Testing getEmployeeFullDetails for 31003...');
  const res = await getEmployeeFullDetails({ employee_code: '31003' });
  console.log('Employee Identifiers:', res.identifiers);
  console.log('Unified Profile found:', res.unifiedProfile?.found);
  console.log('Job:', res.unifiedProfile?.jobTitle);
  console.log('Region / Dept:', res.unifiedProfile?.region, res.unifiedProfile?.department);
  console.log('Bank:', res.unifiedProfile?.bank);
  console.log('Archives:', res.unifiedProfile?.archives);
  console.log('Deductions count:', res.unifiedProfile?.deductions?.length);
  console.log('Discrepancies count:', res.unifiedProfile?.discrepancies?.length);
  console.log('Success!');
}

test().catch(console.error);
