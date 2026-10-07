import { promises as fs } from "node:fs";
import path from "node:path";

export interface Memory {
  key: string;
  value: string;
  /** Epoch ms de la última vez que se guardó/actualizó. */
  updatedAt?: number;
  /** Categoría libre: "dato", "episodio", "gusto", "proyecto"… */
  category?: string;
}

export interface SaveMemoryOptions {
  category?: string;
}

const MEMORY_FILE = path.join(process.cwd(), "data", "memory.json");

export class MemoryService {
  private memories: Memory[] = [];

  async load(): Promise<void> {
    try {
      const data = await fs.readFile(MEMORY_FILE, "utf-8");
      const parsed = JSON.parse(data) as Memory[];
      this.memories = Array.isArray(parsed) ? parsed : [];
    } catch {
      this.memories = [];
    }
  }

  async save(
    key: string,
    value: string,
    options: SaveMemoryOptions = {},
  ): Promise<void> {
    const existingMemory = this.memories.find(
      (memory) => memory.key === key,
    );

    if (existingMemory) {
      existingMemory.value = value;
      existingMemory.updatedAt = Date.now();
      if (options.category) existingMemory.category = options.category;
    } else {
      this.memories.push({
        key,
        value,
        updatedAt: Date.now(),
        ...(options.category ? { category: options.category } : {}),
      });
    }

    await this.persist();
  }

  getAll(): Memory[] {
    return [...this.memories];
  }

  get(key: string): string | undefined {
    return this.memories.find((memory) => memory.key === key)?.value;
  }

  /** Las N memorias más recientes, de la más nueva a la más vieja. */
  recent(limit: number): Memory[] {
    return [...this.memories]
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, limit);
  }

  count(): number {
    return this.memories.length;
  }

  /** Búsqueda por subcadena en clave y valor (sin depender del modelo). */
  search(query: string): Memory[] {
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);

    if (terms.length === 0) return [];

    return this.memories.filter((memory) => {
      const content = `${memory.key} ${memory.value}`.toLowerCase();
      return terms.some((term) => content.includes(term));
    });
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
