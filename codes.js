// Gift code generation — same format as the private gift-certificate-app:
// 5 chars from an unambiguous alphabet (no 0/O, 1/I/L).
import { codeExists } from "./db.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeCode(length = 5) {
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += ALPHABET[Math.floor(Math.random() * ALPHABET.length)] ?? "X";
  }
  return code;
}

export function uniqueCode() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const code = makeCode(5);
    if (!codeExists(code)) return code;
  }
  // Extremely unlikely fallback: longer code.
  let code = makeCode(7);
  while (codeExists(code)) code = makeCode(7);
  return code;
}
