import { LocalDatabase } from '../src/server/local-db.ts';
const db = new LocalDatabase(process.env.T07_DB_PATH);
db.close();
console.log('T07 서버 SQLite 마이그레이션 완료.');
