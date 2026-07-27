import bcrypt from 'bcryptjs';

const BCRYPT_COST = 12;
const BCRYPT_PATTERN = /^\$2[by]\$(\d{2})\$[./A-Za-z0-9]{53}$/;

function toNodeBcrypt(hash: string): string | null {
  const match = BCRYPT_PATTERN.exec(hash);
  const cost = Number(match?.[1]);
  if (!match || !Number.isInteger(cost) || cost < 10 || cost > BCRYPT_COST) {
    return null;
  }

  return hash.startsWith('$2y$') ? `$2b$${hash.slice(4)}` : hash;
}

function toPhpBcrypt(hash: string): string {
  return hash.startsWith('$2b$') ? `$2y$${hash.slice(4)}` : hash;
}

export async function verifyPassword(password: string, phpHash: string): Promise<boolean> {
  const nodeHash = toNodeBcrypt(phpHash);
  if (nodeHash === null) {
    return false;
  }

  try {
    return await bcrypt.compare(password, nodeHash);
  } catch {
    return false;
  }
}

export async function hashPassword(password: string): Promise<string> {
  return toPhpBcrypt(await bcrypt.hash(password, BCRYPT_COST));
}
