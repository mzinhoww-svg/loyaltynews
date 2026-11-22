import { loadRegistries } from './config';
import { validateRegistries } from './validator';

const report = validateRegistries(loadRegistries());
console.log(JSON.stringify(report.counts));
for (const i of report.issues) console.log(`${i.severity.toUpperCase()} [${i.code}] ${i.message}`);
console.log(report.ok ? 'OK' : 'FALHOU');
process.exit(report.ok ? 0 : 1);
