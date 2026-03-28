import { existsSync, readFileSync } from 'node:fs';

const stripWrappingQuotes = (value) => {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
};

export const loadServerEnvFile = ({ envPath, targetEnv = process.env }) => {
  if (!existsSync(envPath)) return false;

  const raw = readFileSync(envPath, 'utf8');
  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex <= 0) return;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = stripWrappingQuotes(trimmed.slice(eqIndex + 1).trim());
    if (!key) return;
    if (targetEnv[key] === undefined || targetEnv[key] === '') {
      targetEnv[key] = value;
    }
  });

  return true;
};
