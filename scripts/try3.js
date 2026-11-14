import { randomUUID } from 'node:crypto';
import { pool } from '../db.js';
import { createAccount, deposit, transfer } from '../bank.js';

const a = await createAccount(1);
const b = await createAccount(1);
await deposit(a.id, 100000); // A starts with ₹1000

const bal = async (id) =>
  Number((await pool.query('SELECT balance_paise FROM accounts WHERE id=$1', [id])).rows[0].balance_paise);
const show = async (label) => console.log(label.padEnd(34), 'A =', await bal(a.id), '| B =', await bal(b.id));
const base = { fromId: a.id, toId: b.id };

await show('start:');

// 1. Normal transfer
await transfer({ ...base, amountPaise: 50000, idemKey: randomUUID() });
await show('after ₹500 transfer:');

// 2. Not enough money
try {
  await transfer({ ...base, amountPaise: 99999999, idemKey: randomUUID() });
} catch (e) {
  console.log('rejected:', e.code);
}
await show('after rejected transfer:');

// 3. Same request sent 3 times (a network retry)
const key = randomUUID();
for (let i = 0; i < 3; i++) {
  await transfer({ ...base, amountPaise: 10000, idemKey: key });
}
await show('after same request x3:');

// 4. Crash between debit and credit
try {
  await transfer({ ...base, amountPaise: 10000, idemKey: randomUUID(), failAfterDebit: true });
} catch (e) {
  console.log('crashed:', e.message);
}
await show('after simulated crash:');

const sum = await pool.query('SELECT SUM(delta_paise) AS total FROM ledger_entries');
console.log('ledger sums to:', sum.rows[0]);
await pool.end();