/** Extract a root JSON string in one pass, retaining state across provider chunks. */
export class JsonStringFieldStream {
  private depth = 0;
  private inString = false;
  private expectingKey = false;
  private expectingValue = false;
  private capture: "key" | "value" | undefined;
  private key: string[] = [];
  private field: string | undefined;
  private escape: string | undefined;
  private completed = false;
  private started = false;

  constructor(private readonly fieldName: string) {}

  push(fragment: string): string {
    if (this.completed) return "";
    const output: string[] = [];
    const append = (text: string) => {
      if (this.capture === "key") this.key.push(text);
      else if (this.capture === "value") output.push(text);
    };
    for (const character of fragment) {
      if (!this.started) {
        if (/\s/.test(character)) continue;
        if (character !== "{") throw new Error("Responder must stream a JSON object.");
        this.started = true;
      }
      if (this.inString) {
        if (this.escape !== undefined) {
          this.escape += character;
          if ((this.escape.length === 2 && character !== "u") || this.escape.length === 6) {
            append(JSON.parse(`"${this.escape}"`));
            this.escape = undefined;
          }
        } else if (character === "\\") {
          this.escape = character;
        } else if (character === '"') {
          this.inString = false;
          if (this.capture === "value") {
            this.completed = true;
            break;
          }
          if (this.capture === "key") {
            this.field = this.key.join("");
            this.key = [];
            this.expectingKey = false;
          }
          this.capture = undefined;
        } else append(character);
      } else if (character === '"') {
        this.inString = true;
        this.capture = this.depth === 1 && this.expectingKey ? "key"
          : this.depth === 1 && this.expectingValue && this.field === this.fieldName ? "value" : undefined;
      } else if (character === "{" || character === "[") {
        this.depth++;
        if (this.depth === 1 && character === "{") this.expectingKey = true;
      } else if (character === "}" || character === "]") {
        this.depth--;
      } else if (this.depth === 1 && character === ":") {
        this.expectingValue = true;
      } else if (this.depth === 1 && character === ",") {
        this.expectingKey = true;
        this.expectingValue = false;
        this.field = undefined;
      }
    }
    return output.join("");
  }
}
