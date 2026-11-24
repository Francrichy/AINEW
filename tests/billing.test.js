import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initializeBilling, walletModeEnabled, walletAvailable, consumeWalletCredits, cashWalletBalance, creditCashWallet } from '../billing.js';

function setup() {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT,created INTEGER)');
  initializeBilling(db);
  db.prepare("INSERT INTO users(id,email,created) VALUES(1,'wallet@example.test',?)").run(Date.now());
  return db;
}
function grant(db, service, bucket, balance, expiresAt = null) {
  const now = Date.now();
  db.prepare("INSERT INTO wallet_balances(user_id,service,bucket,balance,expires_at,updated_at) VALUES(1,?,?,?,?,?)")
    .run(service,bucket,balance,expiresAt,now);
  if (bucket === 'subscription') {
    db.prepare("INSERT INTO credits_ledger(user_id,service,bucket,entry_type,amount,balance_after,reference,description,created_at) VALUES(1,?,'subscription','subscription_credit',?,?,?,'test grant',?)")
      .run(service,balance,balance,'test:'+service+':'+Math.random(),now);
  }
}

test('billing seeds runtime Chat markup and USD/TZS settings', () => {
  const db=setup();
  assert.equal(db.prepare("SELECT customer_price FROM admin_pricing WHERE config_key='markup_multiplier'").get().customer_price,4);
  assert.equal(db.prepare("SELECT customer_price FROM admin_pricing WHERE config_key='usd_tzs'").get().customer_price,2600);
  db.close();
});

test('wallet mode is enabled only after a subscription grant for that service', () => {
  const db=setup();
  grant(db,'chat','subscription',100);
  assert.equal(walletModeEnabled(db,1,'chat'),true);
  assert.equal(walletModeEnabled(db,1,'video'),false);
  db.close();
});

test('consumes subscription balance before purchased balance and writes ledger entries', () => {
  const db=setup();
  grant(db,'chat','subscription',60);
  grant(db,'chat','purchased',50);
  const result=consumeWalletCredits(db,1,'chat',80,'chat test');
  assert.equal(result.consumed,80);
  assert.equal(walletAvailable(db,1,'chat'),30);
  assert.equal(db.prepare("SELECT balance FROM wallet_balances WHERE user_id=1 AND service='chat' AND bucket='subscription'").get().balance,0);
  assert.equal(db.prepare("SELECT balance FROM wallet_balances WHERE user_id=1 AND service='chat' AND bucket='purchased'").get().balance,30);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM credits_ledger WHERE entry_type='usage_debit'").get().n,2);
  db.close();
});

test('expired subscription credits are skipped; purchased credits remain usable', () => {
  const db=setup();
  grant(db,'video','subscription',9,Date.now()-1000);
  grant(db,'video','purchased',2);
  assert.equal(walletAvailable(db,1,'video'),2);
  consumeWalletCredits(db,1,'video',1,'video test');
  assert.equal(walletAvailable(db,1,'video'),1);
  db.close();
});

test('insufficient balance rolls back all partial deductions', () => {
  const db=setup();
  grant(db,'chat','subscription',5);
  grant(db,'chat','purchased',2);
  assert.throws(()=>consumeWalletCredits(db,1,'chat',8),/Salio la Wallet halitoshi/);
  assert.equal(walletAvailable(db,1,'chat'),7);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM credits_ledger WHERE entry_type='usage_debit'").get().n,0);
  db.close();
});

test('cash Wallet top-ups are idempotent and can be spent as TZS', () => {
  const db=setup();
  const first=creditCashWallet(db,1,12000,'cash-test-payment-1','test top-up');
  const duplicate=creditCashWallet(db,1,12000,'cash-test-payment-1','duplicate');
  assert.equal(first.credited,true);
  assert.equal(duplicate.credited,false);
  assert.equal(cashWalletBalance(db,1),12000);
  const debit=consumeWalletCredits(db,1,'cash',2500,'chat test');
  assert.equal(debit.consumed,2500);
  assert.equal(cashWalletBalance(db,1),9500);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM credits_ledger WHERE service='cash' AND entry_type='cash_topup'").get().n,1);
  db.close();
});
