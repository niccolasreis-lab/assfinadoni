import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
test('migração aceita PDF, mantém imagens e rejeita MIME divergente', async () => {
 const db=new PGlite();
 try {
  await db.exec(`create table finance_transaction_attachments(content_type text constraint finance_transaction_attachments_content_type_check check(content_type in ('image/png')), data_url text constraint finance_transaction_attachments_data_url_check check(data_url like 'data:image/%'));`);
  await db.exec(readFileSync(new URL('../../supabase/migrations/20261029144307_finance_pdf_receipts.sql',import.meta.url),'utf8'));
  await db.query('insert into finance_transaction_attachments values ($1,$2)',['application/pdf','data:application/pdf;base64,JVBERi0=']);
  await db.query('insert into finance_transaction_attachments values ($1,$2)',['image/png','data:image/png;base64,YWJj']);
  await assert.rejects(db.query('insert into finance_transaction_attachments values ($1,$2)',['application/pdf','data:image/png;base64,YWJj']));
  await assert.rejects(db.query('insert into finance_transaction_attachments values ($1,$2)',['text/html','data:text/html;base64,YWJj']));
 } finally {await db.close();}
});
