import { pool } from '../db.js';
import { createAccount, deposit, withdraw } from '../bank.js';

const acct = await createAccount(1);
console.log('created', acct);

await deposit(acct.id, 100000); // ₹1000
console.log('after deposit:', (await pool.query('SELECT balance_paise FROM accounts WHERE id=$1', [acct.id])).rows[0]);

await withdraw(acct.id, 30000); // ₹300
console.log('after withdraw:', (await pool.query('SELECT balance_paise FROM accounts WHERE id=$1', [acct.id])).rows[0]);

try {
  await withdraw(acct.id, 999999999);
} catch (e) {
  console.log('rejected:', e.code);
}

console.log(
  'ledger sums to:',
  (await pool.query('SELECT SUM(delta_paise) AS total FROM ledger_entries')).rows[0]
);
await pool.end();