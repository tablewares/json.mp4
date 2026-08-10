import fs from "node:fs";
import path from "node:path";
import { decode as decodeToon } from "@toon-format/toon"; 

export function loadStructuredFile(p) {
  const raw = fs.readFileSync(p, "utf-8");
  const ext = path.extname(p).toLowerCase();
  
  if (ext === ".toon") {
    try {
      const sanitized = raw.replace(/\u00a0/g, " ");
      return decodeToon(sanitized);
    } catch (e) {
      throw new Error(`Failed to decode TOON file ${p}: ${e.message}`);
    }
  }
  
  return JSON.parse(raw);
}