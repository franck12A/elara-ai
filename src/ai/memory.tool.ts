import type { ElaraTool } from "./tools.js";
import type { MemoryService } from "./memory.js";

export function createMemoryTool(
  memory: MemoryService,
): ElaraTool {
  return {
    name: "save_memory",

    description:
      "Guarda información importante sobre el usuario o sobre el proyecto para recordarla en futuras conversaciones.",

    parameters: {
      type: "object",

      properties: {
        key: {
          type: "string",
          description: "Identificador de la memoria.",
        },

        value: {
          type: "string",
          description: "Información que debe recordarse.",
        },
      },

      required: ["key", "value"],
    },

    async execute(args): Promise<string> {
      const key = args.key;
      const value = args.value;

      if (!key || !value) {
        return "No se pudo guardar la memoria porque faltan datos.";
      }

      await memory.save(key, value);

      return `Memoria guardada correctamente: ${key} = ${value}`;
    },
  };
}

export function createGetMemoryTool(
  memory: MemoryService,
): ElaraTool {
  return {
    name: "get_memory",

    description:
      "Busca un recuerdo guardado en la memoria de Elara usando su clave.",

    parameters: {
      type: "object",

      properties: {
        key: {
          type: "string",
          description:
            "La clave exacta del recuerdo que se quiere consultar.",
        },
      },

      required: ["key"],
    },

    async execute(args: Record<string, string>): Promise<string> {
      const key = args.key;

      if (!key) {
        return "No se pudo consultar la memoria porque falta la clave.";
      }

      const value = memory.get(key);

      if (value === undefined) {
        return `No encontré ningún recuerdo con la clave "${key}".`;
      }

      return value;
    },
  };
}

export function createSearchMemoryTool(
  memory: MemoryService,
): ElaraTool {
  return {
    name: "search_memory",

    description:
      "Busca recuerdos de Elara relacionados con una consulta. Úsala cuando el usuario pregunte por algo que podría estar guardado en la memoria pero no conozcas la clave exacta.",

    parameters: {
      type: "object",

      properties: {
        query: {
          type: "string",
          description:
            "Palabras o frase relacionada con el recuerdo que se quiere encontrar.",
        },
      },

      required: ["query"],
    },

    async execute(args: Record<string, string>): Promise<string> {
      const query = args.query?.trim().toLowerCase();

      if (!query) {
        return "No se pudo buscar en la memoria porque falta la consulta.";
      }

      const memories = memory.getAll();

      const terms = query.split(/\s+/);

      const matches = memories.filter((item) => {
        const content =
          `${item.key} ${item.value}`.toLowerCase();

        return terms.some((term) =>
          content.includes(term),
        );
      });

      if (matches.length === 0) {
        return `No encontré recuerdos relacionados con "${args.query}".`;
      }

      return matches
        .map(
          (item) =>
            `${item.key}: ${item.value}`,
        )
        .join("\n");
    },
  };
}