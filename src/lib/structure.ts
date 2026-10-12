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
export type Viewpoint = {
  id: string;
  name: string;
  description: string;
  order: number;
  revision: number;
};
export type DiagramContextLink = {
  id: string;
  entityId: string;
  sourceDiagramId: string | null;
  targetDiagramId: string;
  kind: 'decomposition' | 'viewpoint';
  meaning: string;
  revision: number;
};
export type Structure = {
  viewpoints: Viewpoint[];
  contextLinks: DiagramContextLink[];
  id: string;
  objects: ModelObject[];
  relations: ModelRelation[];
  diagrams: {
    id: string;
    entityId: string | null;
    name: string;
    viewpointId: string | null;
    revision: number;
  }[];
  representations: Representation[];
};
