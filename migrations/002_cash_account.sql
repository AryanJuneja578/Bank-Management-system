BEGIN;

ALTER TABLE accounts DROP CONSTRAINT accounts_balance_paise_check;
ALTER TABLE accounts ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE accounts ADD CONSTRAINT balance_non_negative
  CHECK (is_system OR balance_paise >= 0);

INSERT INTO customers (name, email) VALUES ('BANK CASH', 'cash@bank.internal');
INSERT INTO accounts (customer_id, is_system)
  SELECT id, true FROM customers WHERE email = 'cash@bank.internal';

COMMIT;