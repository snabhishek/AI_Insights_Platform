import { Annotation } from "@langchain/langgraph";
import { RelationshipBuilderOutput } from "./RelationshipBuilder/state";
import { FormBuilderOutput } from "./FormBuilder/state";

export * from "./RelationshipBuilder/state";
export * from "./FormBuilder/state";

export interface HierarchyMapperResult {
  relationshipBuilder?: RelationshipBuilderOutput;
  formBuilder?: FormBuilderOutput;
  summary: string;
  status: string;
}

export const HierarchyMapperStateAnnotation = Annotation.Root({
  relationshipBuilder: Annotation<RelationshipBuilderOutput>,
  formBuilder: Annotation<FormBuilderOutput>,
  summary: Annotation<string>,
  status: Annotation<string>,
});
