export interface FormFieldDefinition {
  name: string;
  fieldId?: string;
  type?: string;
  controlType?: string;
  label: string;
  description?: string;
  isRequired?: boolean;
  options?: any[];
  parentField?: string | null;
  parentFields?: string[];
  requiredParentParams?: string[];
  dependsOn?: string;
  functionalDependencyRef?: string;
}

export interface HierarchicalFormSchema {
  formId?: string;
  groupName?: string;
  priority?: "primary" | "secondary";
  title?: string;
  description?: string;
  targetEntity?: string;
  fields: FormFieldDefinition[];
  subForms?: HierarchicalFormSchema[];
  hierarchyMapping?: {
    parentKey: string;
    childKey: string;
  };
}

export interface FormBuilderOutput {
  sourceId?: string;
  status?: string;
  summary?: string;
  forms?: HierarchicalFormSchema[];
  filterGroups?: HierarchicalFormSchema[];
}
