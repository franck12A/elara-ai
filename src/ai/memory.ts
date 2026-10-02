import { promises as fs } from "node:fs";
import path from "node:path";

export interface Memory {
  key: string;
  value: string;
}

const MEMORY_FILE = path.join(process.cwd(), "data", "memory.json");

export class MemoryService {
  private memories: Memory[] = [];

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(MEMORY_FILE, "utf-8");
      this.memories = JSON.parse(data) as Memory[];
    } catch {
      this.memories = [];
    }
  }

  async save(key: string, value: string): Promise<void> {
    const existingMemory = this.memories.find(
      (memory) => memory.key === key,
    );

    if (existingMemory) {
      existingMemory.value = value;
    } else {
      this.memories.push({ key, value });
    }

    await this.persist();
  }

  getAll(): Memory[] {
    return [...this.memories];
  }

  get(key: string): string | undefined {
    return this.memories.find(
      (memory) => memory.key === key,
    )?.value;
  }

  private async persist(): Promise<void> {
    const directory = path.dirname(MEMORY_FILE);

    await fs.mkdir(directory, { recursive: true });

    await fs.writeFile(
      MEMORY_FILE,
      JSON.stringify(this.memories, null, 2),
      "utf-8",
    );
  }
}