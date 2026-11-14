import { pool } from '../db.js';

const { rows } = await pool.query('SELECT id, name, email FROM customers');
console.log(rows);

await pool.end();