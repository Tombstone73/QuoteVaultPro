/** Object key order and absent optional values are not business edits. Array order remains meaningful. */
export function editorSemanticKey(value: unknown): string {
  if (value == null || value === '') return 'null';
  if (Array.isArray(value)) return `[${value.map(editorSemanticKey).join(',')}]`;
  if (typeof value === 'object') return `{${Object.entries(value).filter(([,item])=>item != null && item !== '').sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${editorSemanticKey(item)}`).join(',')}}`;
  return JSON.stringify(value);
}
export const editorSemanticEqual = (left: unknown, right: unknown) => editorSemanticKey(left) === editorSemanticKey(right);
export const editorNumberEqual = (left: unknown, right: unknown) => left == null || left === '' ? right == null || right === '' : right != null && right !== '' && Number(left) === Number(right);
/** A save acknowledges its submitted values, never edits entered while it was pending. */
export function remainingEditorPatch<T>(current: Record<string,T>, submitted: Record<string,T>): Record<string,T> {
  return Object.fromEntries(Object.entries(current).filter(([field,value])=>!Object.hasOwn(submitted,field) || !editorSemanticEqual(value,submitted[field])));
}
