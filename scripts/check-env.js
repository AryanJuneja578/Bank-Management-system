import 'dotenv/config';

const u = process.env.DATABASE_URL ?? '';
const at = u.lastIndexOf('@');
const colon = u.indexOf(':', u.indexOf('//') + 2);
const masked = at > colon && colon > 0 ? u.slice(0, colon + 1) + '****' + u.slice(at) : u;

console.log('length:', u.length);
console.log(JSON.stringify(masked));