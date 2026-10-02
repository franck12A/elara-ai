export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
}

export interface ToolSchema {
  type: string;
  properties: Record<string, ToolParameter>;
  required: string[];
}

export interface ElaraTool {
  name: string;
  description: string;
  parameters: ToolSchema;
  execute: (args: Record<string, string>) => Promise<string>;
}