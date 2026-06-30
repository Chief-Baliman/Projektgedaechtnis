import dotenv from 'dotenv';
dotenv.config();

export const PORT = Number(process.env.PORT || 8787);
export const APP_ORIGIN = process.env.APP_ORIGIN || `http://localhost:${PORT}`;
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'ChiefHub!2026';
export const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'Q8fX7mLp2VaN9sKd4ZwR1yBc6HtEe5Jn';
export const DATA_DIR = process.env.DATA_DIR || './data';
export const MAX_TEXT_FILE_BYTES = Number(process.env.MAX_TEXT_FILE_BYTES || 850_000);
export const MAX_TOTAL_SCAN_BYTES = Number(process.env.MAX_TOTAL_SCAN_BYTES || 18_000_000);
export const MAX_FILES_TO_READ = Number(process.env.MAX_FILES_TO_READ || 450);

if (ENCRYPTION_KEY.length < 32) {
  console.warn('WARNUNG: ENCRYPTION_KEY sollte mindestens 32 Zeichen haben.');
}
