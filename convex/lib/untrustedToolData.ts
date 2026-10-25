/** A JSON envelope keeps content inside a data value, including fake closing
 * delimiters or fields claiming authority. This label is a model-facing boundary;
 * authorization still belongs to the server's allowlist and stored policy. */
export function untrustedToolData<T>(data: T) {
  return { type: "untrusted_tool_data" as const, untrusted: true as const, data };
}

export function serializeUntrustedToolData(data: unknown): string {
  return JSON.stringify(untrustedToolData(data), (_key, value: unknown) =>
    typeof value === "bigint" ? value.toString() : value);
}
