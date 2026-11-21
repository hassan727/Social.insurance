import { runOfficialPrintForensicAudit } from '../lib/officialPrintMatchingService.ts';

async function main() {
  console.log('Running Official Print Forensic Audit...');
  const { summary, records } = await runOfficialPrintForensicAudit('ALL');
  console.log('=== AUDIT SUMMARY ===');
  console.log(JSON.stringify(summary, null, 2));
  console.log('\nTotal records evaluated:', records.length);
  console.log('Sample record 0:', records[0]);
  console.log('Sample record 1:', records[1]);
}

main().catch(console.error);
