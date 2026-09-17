export type NodeKey =
  | "overview"
  | "rules"
  | "research"
  | "demo"
  | "assets"
  | "business_plan"
  | "ppt"
  | "patent"
  | "copyright"
  | "qa";

export interface NodeDef {
  key: NodeKey;
  label: string;
}

export const NODE_DEFS: NodeDef[] = [
  { key: "overview", label: "项目总览" },
  { key: "rules", label: "比赛规则" },
  { key: "research", label: "研究资料" },
  { key: "demo", label: "产品 Demo" },
  { key: "assets", label: "项目资产" },
  { key: "business_plan", label: "商业计划书" },
  { key: "ppt", label: "PPT" },
  { key: "patent", label: "专利" },
  { key: "copyright", label: "软件著作权" },
  { key: "qa", label: "答辩与检查" },
];
