import fs from "node:fs/promises";

export async function readText(path: string): Promise<string> {
  return fs.readFile(path, "utf8");
}

export async function writeText(path: string, data: string): Promise<void> {
  await fs.writeFile(path, data, "utf8");
}
