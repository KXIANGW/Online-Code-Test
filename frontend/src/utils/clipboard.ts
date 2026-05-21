export function copyToClipboard(text: string): void {
  void navigator.clipboard.writeText(text);
}
