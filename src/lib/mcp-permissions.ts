import { z } from 'zod';
export const mcpCapabilities = [
  'workspaces.list',
  'objects.search',
  'objects.list',
  'objects.read',
  'diagrams.list',
  'objects.create',
  'relations.create',
  'diagrams.create',
  'representations.create',
  'diagrams.export.json',
  'diagrams.export.drawio',
  'diagrams.export.png',
  'diagrams.export.jpeg',
  'diagrams.export.pdf',
  'diagrams.import.json',
  'diagrams.import.drawio',
] as const;
export type McpCapability = (typeof mcpCapabilities)[number];
export const mcpCapabilityLabels: Record<McpCapability, string> = {
  'workspaces.list': 'Список рабочих областей',
  'objects.search': 'Поиск объектов',
  'objects.list': 'Список объектов и связей',
  'objects.read': 'Свойства объектов и связей',
  'diagrams.list': 'Список диаграмм и типов представлений',
  'objects.create': 'Создание решений, проектов, папок и объектов',
  'relations.create': 'Создание связей',
  'diagrams.create': 'Создание диаграмм',
  'representations.create': 'Размещение объектов на диаграммах',
  'diagrams.export.json': 'Экспорт JSON',
  'diagrams.export.drawio': 'Экспорт draw.io',
  'diagrams.export.png': 'Экспорт PNG',
  'diagrams.export.jpeg': 'Экспорт JPEG',
  'diagrams.export.pdf': 'Экспорт PDF',
  'diagrams.import.json': 'Импорт JSON',
  'diagrams.import.drawio': 'Импорт draw.io / XML',
};
export const readOnlyMcpCapabilities: McpCapability[] = [
  'workspaces.list',
  'objects.search',
  'objects.list',
  'objects.read',
  'diagrams.list',
];
export const mcpId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const mcpGrantsSchema = z
  .array(
    z.object({
      workspaceId: mcpId,
      capabilities: z.array(z.enum(mcpCapabilities)).min(1).max(mcpCapabilities.length),
    }),
  )
  .min(1)
  .max(100)
  .refine(
    (grants) => new Set(grants.map((g) => g.workspaceId)).size === grants.length,
    'Области не должны повторяться',
  );
export type McpGrant = z.infer<typeof mcpGrantsSchema>[number];
export function mcpGranted(grants: McpGrant[], workspaceId: string, capability: McpCapability) {
  return grants.some((g) => g.workspaceId === workspaceId && g.capabilities.includes(capability));
}
export function mcpWorkspaceAction(capability: McpCapability): 'read' | 'create' | 'edit' {
  if (capability === 'representations.create') return 'edit';
  return capability.endsWith('.create') || capability.startsWith('diagrams.import.')
    ? 'create'
    : 'read';
}
