import { pool } from './db.js';

export class AppError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

async function getCashAccountId(client) {
  const { rows } = await client.query(
    'SELECT id FROM accounts WHERE is_system = true LIMIT 1'
  );
  return rows[0].id;
}

// delta > 0 = deposit, delta < 0 = withdrawal
async function moveMoney(accountId, amountPaise, type) {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new AppError('INVALID_AMOUNT');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cashId = await getCashAccountId(client);

    // Lock both rows in id order (same rule we'll need for transfers)
    const { rows } = await client.query(
      `SELECT id, balance_paise, status, is_system FROM accounts
       WHERE id IN ($1, $2) ORDER BY id FOR UPDATE`,
      [accountId, cashId]
    );
    const acct = rows.find(r => String(r.id) === String(accountId));
    if (!acct || acct.is_system) throw new AppError('ACCOUNT_NOT_FOUND');
    if (acct.status !== 'ACTIVE') throw new AppError('ACCOUNT_NOT_ACTIVE');

    const delta = type === 'DEPOSIT' ? amountPaise : -amountPaise;
    if (Number(acct.balance_paise) + delta < 0) {
      throw new AppError('INSUFFICIENT_FUNDS');
    }

    const tx = await client.query(
      `INSERT INTO transactions (type, amount_paise) VALUES ($1, $2) RETURNING id`,
      [type, amountPaise]
    );
    const txId = tx.rows[0].id;

    await client.query(
      'UPDATE accounts SET balance_paise = balance_paise + $1 WHERE id = $2',
      [delta, accountId]
    );
    await client.query(
      'UPDATE accounts SET balance_paise = balance_paise - $1 WHERE id = $2',
      [delta, cashId]
    );
    await client.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, delta_paise)
       VALUES ($1, $2, $3), ($1, $4, $5)`,
      [txId, accountId, delta, cashId, -delta]
    );

    await client.query('COMMIT');
    return { transactionId: txId };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export const deposit = (accountId, amountPaise) =>
  moveMoney(accountId, amountPaise, 'DEPOSIT');
export const withdraw = (accountId, amountPaise) =>
  moveMoney(accountId, amountPaise, 'WITHDRAWAL');

export async function createAccount(customerId) {
  const { rows } = await pool.query(
    'INSERT INTO accounts (customer_id) VALUES ($1) RETURNING id, balance_paise',
    [customerId]
  );
  return rows[0];
}
async function getTransactionByKey(key) {
  const { rows } = await pool.query(
    'SELECT id FROM transactions WHERE idempotency_key = $1',
    [key]
  );
  return { transactionId: rows[0].id, replayed: true };
}

export async function transfer({ fromId, toId, amountPaise, idemKey, failAfterDebit = false }) {
  if (!idemKey) throw new AppError('IDEMPOTENCY_KEY_REQUIRED');
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw new AppError('INVALID_AMOUNT');
  if (String(fromId) === String(toId)) throw new AppError('SAME_ACCOUNT');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Claim the idempotency key. If it already exists, this inserts nothing.
    const ins = await client.query(
      `INSERT INTO transactions (type, amount_paise, idempotency_key)
       VALUES ('TRANSFER', $1, $2)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [amountPaise, idemKey]
    );
    if (ins.rowCount === 0) {
      await client.query('ROLLBACK');
      return await getTransactionByKey(idemKey); // same request again: return the original
    }
    const txId = ins.rows[0].id;

    // 2. Lock both accounts, lowest id first (deadlock prevention)
    const { rows } = await client.query(
      `SELECT id, balance_paise, status, is_system FROM accounts
       WHERE id IN ($1, $2) ORDER BY id FOR UPDATE`,
      [fromId, toId]
    );
    if (rows.length !== 2) throw new AppError('ACCOUNT_NOT_FOUND');
    const from = rows.find(r => String(r.id) === String(fromId));
    const to = rows.find(r => String(r.id) === String(toId));

    // 3. Business rules
    if (from.is_system || to.is_system) throw new AppError('ACCOUNT_NOT_FOUND');
    if (from.status !== 'ACTIVE' || to.status !== 'ACTIVE') throw new AppError('ACCOUNT_NOT_ACTIVE');
    if (Number(from.balance_paise) < amountPaise) throw new AppError('INSUFFICIENT_FUNDS');

    // 4. Move the money
    await client.query(
      'UPDATE accounts SET balance_paise = balance_paise - $1 WHERE id = $2',
      [amountPaise, fromId]
    );

    // Test-only switch: simulate a crash AFTER the debit but BEFORE the credit
    if (failAfterDebit) throw new Error('SIMULATED_CRASH');

    await client.query(
      'UPDATE accounts SET balance_paise = balance_paise + $1 WHERE id = $2',
      [amountPaise, toId]
    );

    // 5. Ledger: two rows that sum to zero
    await client.query(
      `INSERT INTO ledger_entries (transaction_id, account_id, delta_paise)
       VALUES ($1, $2, $3), ($1, $4, $5)`,
      [txId, fromId, -amountPaise, toId, amountPaise]
    );

    await client.query('COMMIT');
    return { transactionId: txId, replayed: false };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}