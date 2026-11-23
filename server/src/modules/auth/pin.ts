import bcrypt from 'bcryptjs';

// bcryptjs (pure JS), not bcrypt: no native build step that npm 11 might skip.
const PIN_HASH_COST = 10;

export const hashPin = (pin: string): Promise<string> => bcrypt.hash(pin, PIN_HASH_COST);

export const verifyPin = (pin: string, hash: string): Promise<boolean> => bcrypt.compare(pin, hash);
