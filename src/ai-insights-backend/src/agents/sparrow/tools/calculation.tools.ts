import { z } from "zod";
import { SparrowState } from "../sparrowState";

const evidenceSchema = z.object({
  resultIndex: z.number().int().nonnegative().describe("Index of successful current-turn toolResults evidence."),
  path: z.array(z.string().min(1)).min(1).max(12).describe('Path relative to result.data; use "*" to select all elements of an array, e.g. ["modelResults","0","periods","*","predicted"].'),
}).strict();

// Flat source fields keep provider declarations free of nested discriminator unions.
const inputSchema = z.object({
  source: z.enum(["tool", "user", "constant"]),
  resultIndex: evidenceSchema.shape.resultIndex.optional(),
  path: evidenceSchema.shape.path.optional(),
  value: z.number().finite().optional(),
  quote: z.string().min(1).optional().describe("Exact quote containing this number from the current user request or a clarification answer, never an assistant answer."),
  name: z.enum(["one", "hundred"]).optional().describe("Dimensionless arithmetic constant only. Business inputs need evidence."),
}).strict().superRefine((input, ctx) => {
  const required = input.source === "tool" ? ["resultIndex", "path"] : input.source === "user" ? ["value", "quote"] : ["name"];
  for (const key of required) {
    if (input[key as keyof typeof input] === undefined) ctx.addIssue({ code: "custom", message: `${input.source} input requires '${key}'.` });
  }
  for (const key of Object.keys(input)) {
    if (key !== "source" && !required.includes(key) && input[key as keyof typeof input] !== undefined) ctx.addIssue({ code: "custom", message: `${input.source} input cannot supply '${key}'.` });
  }
});

export const calculationSchema = z.object({
  purpose: z.string().min(1).describe("Explain the chosen method and why its inputs answer this request."),
  assumptions: z.array(z.string()).max(16).describe("Business assumptions chosen by the agent; disclose them in the answer."),
  bindings: z.array(z.object({
    name: z.string().min(1),
    input: inputSchema,
  }).strict()).min(1).max(32),
  calculations: z.array(z.object({
    name: z.string().min(1),
    operation: z.enum(["add", "subtract", "multiply", "divide", "sum", "mean", "min", "max"]),
    inputs: z.array(z.string().min(1)).min(1).max(2).describe("Names of bindings or earlier calculations. Binary operations require two; reductions require one."),
  }).strict()).min(1).max(32),
  outputs: z.array(z.object({
    name: z.string().min(1).describe("Binding/calculation name to return."),
    label: z.string().min(1),
    unit: z.string().optional().describe("Evidenced unit only; omit an unknown currency."),
    labels: evidenceSchema.optional().describe("Optional evidence path for vector labels such as forecast dates."),
  }).strict()).min(1).max(32),
}).strict();

type NumericValue = number | number[];
type EvidenceRef = z.infer<typeof evidenceSchema>;

function readEvidence(ref: EvidenceRef, state: SparrowState): unknown {
  const result = state.toolResults[ref.resultIndex];
  if (!result?.success || result.toolName === "analysisPlanner") throw new Error("Calculation inputs require successful current-turn execution evidence.");
  let visited = 0;
  const visit = (value: any, index: number): unknown => {
    if (++visited > 12000) throw new Error("Evidence selection exceeds the calculation limit; select a narrower result path.");
    if (index === ref.path.length) return value;
    const key = ref.path[index];
    if (key === "*") {
      if (!Array.isArray(value) || !value.length || value.length > 1000) throw new Error("Wildcard evidence must be a nonempty array of at most 1000 values.");
      return value.map(item => visit(item, index + 1));
    }
    if (value === null || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, key)
      || ["__proto__", "prototype", "constructor"].includes(key)) throw new Error(`Evidence path does not contain '${key}'.`);
    return visit(value[key], index + 1);
  };
  return visit(result.data, 0);
}

function numeric(value: unknown): NumericValue {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value) && value.length > 0 && value.length <= 1000
    && value.every(item => typeof item === "number" && Number.isFinite(item))) return value;
  throw new Error("Calculation inputs and results must be finite numbers or nonempty numeric vectors; missing data is not zero.");
}

function calculate(operation: string, inputs: NumericValue[]): NumericValue {
  const binary = ["add", "subtract", "multiply", "divide"].includes(operation);
  if (inputs.length !== (binary ? 2 : 1)) throw new Error(`Wrong input count for '${operation}'.`);
  if (!binary) {
    const values = Array.isArray(inputs[0]) ? inputs[0] : [inputs[0]];
    const total = () => values.reduce((a, b) => a + b, 0);
    return numeric(operation === "sum" ? total() : operation === "mean" ? total() / values.length
      : operation === "min" ? Math.min(...values) : Math.max(...values));
  }
  const [a, b] = inputs;
  const apply = (left: number, right: number): number => {
    if (operation === "divide" && right === 0) throw new Error("Division by zero; obtain valid inputs or explain the undefined result.");
    return numeric(operation === "add" ? left + right : operation === "subtract" ? left - right
      : operation === "multiply" ? left * right : left / right) as number;
  };
  if (!Array.isArray(a) && !Array.isArray(b)) return apply(a, b);
  if (Array.isArray(a) && Array.isArray(b) && a.length !== b.length) throw new Error("Vector lengths differ; align observations before calculating.");
  const length = Array.isArray(a) ? a.length : (b as number[]).length;
  return Array.from({ length }, (_, index) => apply(Array.isArray(a) ? a[index] : a, Array.isArray(b) ? b[index] : b));
}

// The agent supplies the method. This executor knows arithmetic and evidence, not business formulas.
export function createCalculateMetricTool() {
  return {
    name: "calculateMetric",
    description: "Execute an agent-authored arithmetic plan over successful tool evidence and quoted user inputs. Supports scalars, vectors, reductions and chained calculations. No business formula, arbitrary code, external access or invented observations.",
    schema: calculationSchema,
    invokeWithContext: async (rawArgs: z.infer<typeof calculationSchema>, state: SparrowState) => {
      const args = calculationSchema.parse(rawArgs);
      const values = new Map<string, NumericValue>();
      const provenance: Record<string, unknown>[] = [];
      const save = (name: string, value: NumericValue) => {
        if (values.has(name)) throw new Error(`Duplicate calculation name '${name}'.`);
        values.set(name, value);
      };
      for (const binding of args.bindings) {
        const input = binding.input;
        if (input.source === "tool") {
          save(binding.name, numeric(readEvidence({ resultIndex: input.resultIndex!, path: input.path! }, state)));
          const result = state.toolResults[input.resultIndex!];
          provenance.push({ name: binding.name, ...input, toolName: result.toolName, executedAt: result.executedAt, args: result.args });
        } else if (input.source === "user") {
          const userTexts = [state.userQuery, state.clarificationAnswer, ...(state.clarificationHistory ?? []).map(reply => reply.answer)];
          const quotedNumbers = input.quote!.match(/[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?/gi) ?? [];
          if (!userTexts.some(text => typeof text === "string" && text.includes(input.quote!))
            || !quotedNumbers.some(text => Number(text.replace(/,/g, "")) === input.value)) {
            throw new Error("User input must match a number in an exact quote from the current request or clarification answers.");
          }
          save(binding.name, input.value!);
          provenance.push({ name: binding.name, ...input });
        } else {
          save(binding.name, input.name === "one" ? 1 : 100);
          provenance.push({ name: binding.name, source: input.source, constant: input.name });
        }
      }
      for (const step of args.calculations) {
        const inputs = step.inputs.map(name => {
          const value = values.get(name);
          if (value === undefined) throw new Error(`Unknown or forward calculation reference '${name}'.`);
          return value;
        });
        save(step.name, calculate(step.operation, inputs));
      }
      const outputs = args.outputs.map(output => {
        const value = values.get(output.name);
        if (value === undefined) throw new Error(`Unknown output '${output.name}'.`);
        const labels = output.labels ? readEvidence(output.labels, state) : undefined;
        if (labels !== undefined && (!Array.isArray(value) || !Array.isArray(labels) || labels.length !== value.length
          || !labels.every(label => typeof label === "string" || typeof label === "number"))) {
          throw new Error("Output labels must match the numeric vector length and contain scalar labels.");
        }
        return { name: output.name, label: output.label, unit: output.unit, value, ...(labels === undefined ? {} : { labels }) };
      });
      return { success: true, purpose: args.purpose, assumptions: args.assumptions, calculations: args.calculations, provenance, outputs };
    },
  };
}
