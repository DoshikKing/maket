import type { ModelObject, ModelRelation } from './model';
export type Representation = {
  id: string;
  entityId: string;
  diagramId: string;
  diagramName: string;
  notation: string;
  type: string;
  name: string;
};
export type Structure = {
  id: string;
  objects: ModelObject[];
  relations: ModelRelation[];
  diagrams: { id: string; entityId: string | null; name: string }[];
  representations: Representation[];
};
